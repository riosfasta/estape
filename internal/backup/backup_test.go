package backup

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestReadBSONDocument(t *testing.T) {
	// Build sample documents
	doc1 := bson.D{{Key: "_id", Value: primitive.NewObjectID()}, {Key: "name", Value: "Alice"}}
	doc2 := bson.D{{Key: "_id", Value: primitive.NewObjectID()}, {Key: "name", Value: "Bob"}, {Key: "count", Value: int64(123)}}

	b1, err := bson.Marshal(doc1)
	if err != nil {
		t.Fatalf("marshal doc1: %v", err)
	}
	b2, err := bson.Marshal(doc2)
	if err != nil {
		t.Fatalf("marshal doc2: %v", err)
	}

	buf := bytes.NewBuffer(append(b1, b2...))

	read1, err := ReadBSONDocument(buf)
	if err != nil {
		t.Fatalf("read doc1: %v", err)
	}
	var out1 bson.M
	if err := bson.Unmarshal(read1, &out1); err != nil {
		t.Fatalf("unmarshal read1: %v", err)
	}
	if out1["name"] != "Alice" {
		t.Fatalf("expected Alice, got %v", out1["name"])
	}

	read2, err := ReadBSONDocument(buf)
	if err != nil {
		t.Fatalf("read doc2: %v", err)
	}
	var out2 bson.M
	if err := bson.Unmarshal(read2, &out2); err != nil {
		t.Fatalf("unmarshal read2: %v", err)
	}
	if out2["name"] != "Bob" || out2["count"] != int64(123) {
		t.Fatalf("expected Bob/123, got %v", out2)
	}

	// Next read should be EOF
	_, err = ReadBSONDocument(buf)
	if err != io.EOF {
		t.Fatalf("expected EOF, got %v", err)
	}
}

func TestReadBSONDocument_Invalid(t *testing.T) {
	// Less than 5 bytes
	short := bytes.NewReader([]byte{0x02, 0x00, 0x00, 0x00})
	_, err := ReadBSONDocument(short)
	if err == nil {
		t.Fatal("expected error for short size")
	}

	// Invalid BSON content
	var badBuf [8]byte
	binary.LittleEndian.PutUint32(badBuf[:4], 8)
	badBuf[7] = 0x55 // Not ending in null terminator
	_, err = ReadBSONDocument(bytes.NewReader(badBuf[:]))
	if err == nil {
		t.Fatal("expected error for invalid BSON data")
	}
}

func TestZipStructureAndManifest(t *testing.T) {
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	manifest := &Manifest{
		App:              "bugmega",
		Version:          "1.0",
		DatabaseName:     "testdb",
		ExportedAt:       time.Now().UTC(),
		TotalCollections: 1,
		TotalDocuments:   1,
		Collections: []CollectionMeta{
			{Name: "users", DocumentCount: 1, SizeBytes: 50},
		},
	}
	mBytes, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	mw, err := zw.Create("manifest.json")
	if err != nil {
		t.Fatalf("create manifest: %v", err)
	}
	if _, err := mw.Write(mBytes); err != nil {
		t.Fatalf("write: %v", err)
	}

	doc := bson.D{{Key: "_id", Value: primitive.NewObjectID()}, {Key: "title", Value: "Sample"}}
	docBytes, err := bson.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal doc: %v", err)
	}
	bw, err := zw.Create("testdb/users.bson")
	if err != nil {
		t.Fatalf("create bson entry: %v", err)
	}
	if _, err := bw.Write(docBytes); err != nil {
		t.Fatalf("write bson: %v", err)
	}

	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}

	var foundManifest, foundBson bool
	for _, f := range zr.File {
		if f.Name == "manifest.json" {
			foundManifest = true
		}
		if f.Name == "testdb/users.bson" {
			foundBson = true
			rc, err := f.Open()
			if err != nil {
				t.Fatalf("open bson file: %v", err)
			}
			readDoc, err := ReadBSONDocument(rc)
			rc.Close()
			if err != nil {
				t.Fatalf("read bson doc: %v", err)
			}
			var m bson.M
			if err := bson.Unmarshal(readDoc, &m); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if m["title"] != "Sample" {
				t.Fatalf("expected Sample, got %v", m["title"])
			}
		}
	}

	if !foundManifest {
		t.Fatal("manifest.json not found in zip")
	}
	if !foundBson {
		t.Fatal("users.bson not found in zip")
	}
}
