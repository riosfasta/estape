package backup

import (
	"archive/zip"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	mongomodels "go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

// Manifest defines the metadata stored inside the backup zip archive.
type Manifest struct {
	App              string           `json:"app"`
	Version          string           `json:"version"`
	DatabaseName     string           `json:"database_name"`
	ExportedAt       time.Time        `json:"exported_at"`
	TotalCollections int              `json:"total_collections"`
	TotalDocuments   int64            `json:"total_documents"`
	Collections      []CollectionMeta `json:"collections"`
}

// CollectionMeta stores document count and size info for a single collection.
type CollectionMeta struct {
	Name          string `json:"name"`
	DocumentCount int64  `json:"document_count"`
	SizeBytes     int64  `json:"size_bytes"`
}

// DatabaseStats contains real-time summary for the active database.
type DatabaseStats struct {
	DatabaseName     string           `json:"database_name"`
	TotalCollections int              `json:"total_collections"`
	TotalDocuments   int64            `json:"total_documents"`
	Collections      []CollectionMeta `json:"collections"`
}

// RestoreResult reports the outcome of restoring from a backup file.
type RestoreResult struct {
	DatabaseName     string             `json:"database_name"`
	TotalCollections int                `json:"total_collections"`
	TotalDocuments   int64              `json:"total_documents"`
	Collections      []CollectionResult `json:"collections"`
	Duration         string             `json:"duration"`
}

// MigrateResult reports the outcome of migrating live to another MongoDB server.
type MigrateResult struct {
	TargetDatabase string             `json:"target_database"`
	TotalDocuments int64              `json:"total_documents"`
	Collections    []CollectionResult `json:"collections"`
	Duration       string             `json:"duration"`
}

// CollectionResult reports single collection restore/migration counts.
type CollectionResult struct {
	Name          string `json:"name"`
	DocumentCount int64  `json:"document_count"`
}

// ConnectionTestResult reports connection test status to a remote MongoDB server.
type ConnectionTestResult struct {
	Success          bool     `json:"success"`
	Database         string   `json:"database"`
	CollectionsCount int      `json:"collections_count"`
	Collections      []string `json:"collections"`
	Message          string   `json:"message"`
}

// GetDatabaseStats returns counts and sizes for all collections in db.
func GetDatabaseStats(ctx context.Context, db *mongo.Database) (*DatabaseStats, error) {
	colls, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("list collections: %w", err)
	}

	sort.Strings(colls)
	stats := &DatabaseStats{
		DatabaseName: db.Name(),
		Collections:  make([]CollectionMeta, 0, len(colls)),
	}

	for _, colName := range colls {
		if strings.HasPrefix(colName, "system.") {
			continue
		}
		col := db.Collection(colName)
		count, err := col.EstimatedDocumentCount(ctx)
		if err != nil {
			count, _ = col.CountDocuments(ctx, bson.M{})
		}
		stats.Collections = append(stats.Collections, CollectionMeta{
			Name:          colName,
			DocumentCount: count,
		})
		stats.TotalDocuments += count
	}
	stats.TotalCollections = len(stats.Collections)
	return stats, nil
}

// CreateBackupZip streams all user collections into a zip archive as standard BSON
// and metadata files compatible with official mongorestore and bugmega restore.
func CreateBackupZip(ctx context.Context, db *mongo.Database, w io.Writer) (*Manifest, error) {
	colls, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("list collections: %w", err)
	}

	sort.Strings(colls)
	var targetColls []string
	for _, c := range colls {
		if !strings.HasPrefix(c, "system.") {
			targetColls = append(targetColls, c)
		}
	}

	zipWriter := zip.NewWriter(w)
	manifest := &Manifest{
		App:              "bugmega",
		Version:          "1.0",
		DatabaseName:     db.Name(),
		ExportedAt:       time.Now().UTC(),
		TotalCollections: len(targetColls),
		Collections:      make([]CollectionMeta, 0, len(targetColls)),
	}

	dbPrefix := db.Name()

	for _, colName := range targetColls {
		col := db.Collection(colName)

		// 1. Export collection indexes to metadata.json
		indexesCursor, err := col.Indexes().List(ctx)
		if err == nil {
			var indexSpecs []bson.M
			for indexesCursor.Next(ctx) {
				var spec bson.M
				if err := indexesCursor.Decode(&spec); err == nil {
					indexSpecs = append(indexSpecs, spec)
				}
			}
			indexesCursor.Close(ctx)

			metaWrapper := bson.M{"indexes": indexSpecs}
			metaBytes, err := json.MarshalIndent(metaWrapper, "", "  ")
			if err == nil {
				metaHeader := &zip.FileHeader{
					Name:     fmt.Sprintf("%s/%s.metadata.json", dbPrefix, colName),
					Method:   zip.Deflate,
					Modified: manifest.ExportedAt,
				}
				if mw, err := zipWriter.CreateHeader(metaHeader); err == nil {
					_, _ = mw.Write(metaBytes)
				}
			}
		}

		// 2. Export raw BSON documents to .bson file
		cursor, err := col.Find(ctx, bson.M{})
		if err != nil {
			zipWriter.Close()
			return nil, fmt.Errorf("query collection %s: %w", colName, err)
		}

		bsonHeader := &zip.FileHeader{
			Name:     fmt.Sprintf("%s/%s.bson", dbPrefix, colName),
			Method:   zip.Deflate,
			Modified: manifest.ExportedAt,
		}
		bw, err := zipWriter.CreateHeader(bsonHeader)
		if err != nil {
			cursor.Close(ctx)
			zipWriter.Close()
			return nil, fmt.Errorf("create zip entry for %s: %w", colName, err)
		}

		var docCount int64
		var sizeBytes int64

		for cursor.Next(ctx) {
			raw := cursor.Current
			n, err := bw.Write(raw)
			if err != nil {
				cursor.Close(ctx)
				zipWriter.Close()
				return nil, fmt.Errorf("write bson document for %s: %w", colName, err)
			}
			docCount++
			sizeBytes += int64(n)
		}

		if err := cursor.Err(); err != nil {
			cursor.Close(ctx)
			zipWriter.Close()
			return nil, fmt.Errorf("cursor error for %s: %w", colName, err)
		}
		cursor.Close(ctx)

		manifest.Collections = append(manifest.Collections, CollectionMeta{
			Name:          colName,
			DocumentCount: docCount,
			SizeBytes:     sizeBytes,
		})
		manifest.TotalDocuments += docCount
	}

	// 3. Write manifest.json at zip root
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		zipWriter.Close()
		return nil, fmt.Errorf("marshal manifest: %w", err)
	}
	mw, err := zipWriter.CreateHeader(&zip.FileHeader{
		Name:     "manifest.json",
		Method:   zip.Deflate,
		Modified: manifest.ExportedAt,
	})
	if err != nil {
		zipWriter.Close()
		return nil, fmt.Errorf("create manifest entry: %w", err)
	}
	if _, err := mw.Write(manifestBytes); err != nil {
		zipWriter.Close()
		return nil, fmt.Errorf("write manifest: %w", err)
	}

	if err := zipWriter.Close(); err != nil {
		return nil, fmt.Errorf("finalize zip archive: %w", err)
	}

	return manifest, nil
}

// ReadBSONDocument reads a single BSON document from an io.Reader.
func ReadBSONDocument(r io.Reader) (bson.Raw, error) {
	var sizeBuf [4]byte
	if _, err := io.ReadFull(r, sizeBuf[:]); err != nil {
		return nil, err
	}
	size := binary.LittleEndian.Uint32(sizeBuf[:])
	if size < 5 || size > 16<<20 {
		return nil, fmt.Errorf("invalid bson document size: %d", size)
	}
	buf := make([]byte, size)
	copy(buf[:4], sizeBuf[:])
	if _, err := io.ReadFull(r, buf[4:]); err != nil {
		return nil, err
	}
	raw := bson.Raw(buf)
	if err := raw.Validate(); err != nil {
		return nil, fmt.Errorf("invalid bson data: %w", err)
	}
	return raw, nil
}

// RestoreBackupZip restores collections from an uploaded zip reader.
// If cleanExisting is true, target collections are dropped before restoring documents.
func RestoreBackupZip(ctx context.Context, db *mongo.Database, r io.ReaderAt, size int64, cleanExisting bool) (*RestoreResult, error) {
	startTime := time.Now()
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, fmt.Errorf("open zip archive: %w", err)
	}

	// Map collections by base name: e.g. "users" -> (*zip.File bson, *zip.File metadata)
	type colFiles struct {
		bsonFile *zip.File
		metaFile *zip.File
	}
	cols := make(map[string]*colFiles)

	for _, f := range zr.File {
		base := filepath.Base(f.Name)
		if strings.HasSuffix(base, ".bson") {
			name := strings.TrimSuffix(base, ".bson")
			if strings.HasPrefix(name, "system.") {
				continue
			}
			if cols[name] == nil {
				cols[name] = &colFiles{}
			}
			cols[name].bsonFile = f
		} else if strings.HasSuffix(base, ".metadata.json") {
			name := strings.TrimSuffix(base, ".metadata.json")
			if strings.HasPrefix(name, "system.") {
				continue
			}
			if cols[name] == nil {
				cols[name] = &colFiles{}
			}
			cols[name].metaFile = f
		}
	}

	if len(cols) == 0 {
		return nil, errors.New("no bson collection files found in the archive")
	}

	// Sort collection names for predictable order
	sortedNames := make([]string, 0, len(cols))
	for name := range cols {
		sortedNames = append(sortedNames, name)
	}
	sort.Strings(sortedNames)

	result := &RestoreResult{
		DatabaseName: db.Name(),
		Collections:  make([]CollectionResult, 0, len(sortedNames)),
	}

	const batchSize = 500

	for _, colName := range sortedNames {
		cf := cols[colName]
		if cf.bsonFile == nil {
			continue
		}

		targetCol := db.Collection(colName)

		if cleanExisting {
			_ = targetCol.Drop(ctx)
		}

		rc, err := cf.bsonFile.Open()
		if err != nil {
			return nil, fmt.Errorf("open %s from zip: %w", cf.bsonFile.Name, err)
		}

		var batch []any
		var docCount int64

		for {
			rawDoc, err := ReadBSONDocument(rc)
			if err != nil {
				if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
					break
				}
				rc.Close()
				return nil, fmt.Errorf("read document in %s: %w", colName, err)
			}

			if cleanExisting {
				batch = append(batch, rawDoc)
				docCount++
				if len(batch) >= batchSize {
					if _, err := targetCol.InsertMany(ctx, batch); err != nil {
						rc.Close()
						return nil, fmt.Errorf("insert batch into %s: %w", colName, err)
					}
					batch = batch[:0]
				}
			} else {
				// Upsert mode: match by _id
				var m bson.M
				if err := bson.Unmarshal(rawDoc, &m); err == nil {
					if id, ok := m["_id"]; ok {
						opts := mongomodels.Replace().SetUpsert(true)
						_, _ = targetCol.ReplaceOne(ctx, bson.M{"_id": id}, rawDoc, opts)
					} else {
						_, _ = targetCol.InsertOne(ctx, rawDoc)
					}
					docCount++
				}
			}
		}
		rc.Close()

		if cleanExisting && len(batch) > 0 {
			if _, err := targetCol.InsertMany(ctx, batch); err != nil {
				return nil, fmt.Errorf("insert final batch into %s: %w", colName, err)
			}
		}

		// Restore indexes from metadata if available
		if cf.metaFile != nil {
			restoreIndexesFromMetaFile(ctx, targetCol, cf.metaFile)
		}

		result.Collections = append(result.Collections, CollectionResult{
			Name:          colName,
			DocumentCount: docCount,
		})
		result.TotalDocuments += docCount
	}

	result.TotalCollections = len(result.Collections)
	result.Duration = time.Since(startTime).Round(time.Millisecond).String()
	return result, nil
}

// restoreIndexesFromMetaFile extracts index definitions from metadata.json and creates them.
func restoreIndexesFromMetaFile(ctx context.Context, col *mongo.Collection, f *zip.File) {
	rc, err := f.Open()
	if err != nil {
		return
	}
	defer rc.Close()

	var meta struct {
		Indexes []bson.M `json:"indexes"`
	}
	if err := json.NewDecoder(rc).Decode(&meta); err != nil {
		return
	}

	var models []mongo.IndexModel
	for _, raw := range meta.Indexes {
		name, _ := raw["name"].(string)
		if name == "_id_" {
			continue
		}
		key, ok := raw["key"]
		if !ok {
			continue
		}
		opts := mongomodels.Index()
		if unique, ok := raw["unique"].(bool); ok && unique {
			opts.SetUnique(true)
		}
		if sparse, ok := raw["sparse"].(bool); ok && sparse {
			opts.SetSparse(true)
		}
		if name != "" {
			opts.SetName(name)
		}
		models = append(models, mongo.IndexModel{Keys: key, Options: opts})
	}

	if len(models) > 0 {
		_, _ = col.Indexes().CreateMany(ctx, models)
	}
}

// TestMongoConnection tests connectivity and basic queries against a remote MongoDB server.
func TestMongoConnection(ctx context.Context, uri string, dbName string) (*ConnectionTestResult, error) {
	uri = strings.TrimSpace(uri)
	if uri == "" {
		return nil, errors.New("target MongoDB URI is required")
	}
	if dbName == "" {
		dbName = "bugmega"
	}

	clientOpts := mongomodels.Client().ApplyURI(uri).SetTimeout(8 * time.Second)
	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		return nil, fmt.Errorf("connection setup failed: %w", err)
	}
	defer func() {
		discCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = client.Disconnect(discCtx)
	}()

	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		return nil, fmt.Errorf("ping failed: %w", err)
	}

	targetDB := client.Database(dbName)
	colls, err := targetDB.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("list collections failed: %w", err)
	}

	var userColls []string
	for _, c := range colls {
		if !strings.HasPrefix(c, "system.") {
			userColls = append(userColls, c)
		}
	}

	sort.Strings(userColls)
	return &ConnectionTestResult{
		Success:          true,
		Database:         dbName,
		CollectionsCount: len(userColls),
		Collections:      userColls,
		Message:          fmt.Sprintf("Successfully connected to database '%s' (found %d existing user collections)", dbName, len(userColls)),
	}, nil
}

// MigrateLive performs live data and index migration from sourceDB to targetURI.
func MigrateLive(ctx context.Context, sourceDB *mongo.Database, targetURI string, targetDBName string, cleanTarget bool) (*MigrateResult, error) {
	startTime := time.Now()
	targetURI = strings.TrimSpace(targetURI)
	if targetURI == "" {
		return nil, errors.New("target MongoDB URI is required")
	}
	targetDBName = strings.TrimSpace(targetDBName)
	if targetDBName == "" {
		targetDBName = sourceDB.Name()
	}

	clientOpts := mongomodels.Client().ApplyURI(targetURI).SetTimeout(30 * time.Second)
	targetClient, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		return nil, fmt.Errorf("connect target mongodb: %w", err)
	}
	defer func() {
		discCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = targetClient.Disconnect(discCtx)
	}()

	if err := targetClient.Ping(ctx, readpref.Primary()); err != nil {
		return nil, fmt.Errorf("ping target mongodb: %w", err)
	}

	targetDB := targetClient.Database(targetDBName)

	colls, err := sourceDB.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("list source collections: %w", err)
	}

	sort.Strings(colls)
	result := &MigrateResult{
		TargetDatabase: targetDBName,
		Collections:    make([]CollectionResult, 0, len(colls)),
	}

	const batchSize = 500

	for _, colName := range colls {
		if strings.HasPrefix(colName, "system.") {
			continue
		}

		sourceCol := sourceDB.Collection(colName)
		targetCol := targetDB.Collection(colName)

		if cleanTarget {
			_ = targetCol.Drop(ctx)
		}

		cursor, err := sourceCol.Find(ctx, bson.M{})
		if err != nil {
			return nil, fmt.Errorf("query collection %s: %w", colName, err)
		}

		var batch []any
		var docCount int64

		for cursor.Next(ctx) {
			raw := make([]byte, len(cursor.Current))
			copy(raw, cursor.Current)
			batch = append(batch, bson.Raw(raw))
			docCount++

			if len(batch) >= batchSize {
				if _, err := targetCol.InsertMany(ctx, batch); err != nil {
					cursor.Close(ctx)
					return nil, fmt.Errorf("insert batch into %s: %w", colName, err)
				}
				batch = batch[:0]
			}
		}

		if err := cursor.Err(); err != nil {
			cursor.Close(ctx)
			return nil, fmt.Errorf("cursor error for %s: %w", colName, err)
		}
		cursor.Close(ctx)

		if len(batch) > 0 {
			if _, err := targetCol.InsertMany(ctx, batch); err != nil {
				return nil, fmt.Errorf("insert final batch into %s: %w", colName, err)
			}
		}

		// Copy indexes
		copyIndexes(ctx, sourceCol, targetCol)

		result.Collections = append(result.Collections, CollectionResult{
			Name:          colName,
			DocumentCount: docCount,
		})
		result.TotalDocuments += docCount
	}

	result.Duration = time.Since(startTime).Round(time.Millisecond).String()
	return result, nil
}

// copyIndexes copies index specifications from sourceCol to targetCol.
func copyIndexes(ctx context.Context, sourceCol, targetCol *mongo.Collection) {
	cursor, err := sourceCol.Indexes().List(ctx)
	if err != nil {
		return
	}
	defer cursor.Close(ctx)

	var models []mongo.IndexModel
	for cursor.Next(ctx) {
		var raw bson.M
		if err := cursor.Decode(&raw); err != nil {
			continue
		}
		name, _ := raw["name"].(string)
		if name == "_id_" {
			continue
		}
		key, ok := raw["key"]
		if !ok {
			continue
		}
		opts := mongomodels.Index()
		if unique, ok := raw["unique"].(bool); ok && unique {
			opts.SetUnique(true)
		}
		if sparse, ok := raw["sparse"].(bool); ok && sparse {
			opts.SetSparse(true)
		}
		if name != "" {
			opts.SetName(name)
		}
		models = append(models, mongo.IndexModel{Keys: key, Options: opts})
	}

	if len(models) > 0 {
		_, _ = targetCol.Indexes().CreateMany(ctx, models)
	}
}
