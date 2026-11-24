package store

import (
	"context"
	"strings"
	"time"

	"bugmark/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	mongomodels "go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Store) CreateTenant(ctx context.Context, tenant *models.Tenant) error {
	tenant.ID = primitive.NewObjectID()
	tenant.Subdomain = strings.ToLower(strings.TrimSpace(tenant.Subdomain))
	if tenant.Status == "" {
		tenant.Status = models.TenantStatusDraft
	}
	now := time.Now()
	tenant.CreatedAt = now
	tenant.UpdatedAt = now

	_, err := s.C("tenants").InsertOne(ctx, tenant)
	return err
}

func (s *Store) GetTenantByID(ctx context.Context, id primitive.ObjectID) (*models.Tenant, error) {
	var tenant models.Tenant
	err := s.C("tenants").FindOne(ctx, bson.M{"_id": id}).Decode(&tenant)
	if err != nil {
		return nil, err
	}
	return &tenant, nil
}

func (s *Store) GetTenantBySubdomain(ctx context.Context, subdomain string) (*models.Tenant, error) {
	subdomain = strings.ToLower(strings.TrimSpace(subdomain))
	var tenant models.Tenant
	err := s.C("tenants").FindOne(ctx, bson.M{"subdomain": subdomain}).Decode(&tenant)
	if err != nil {
		return nil, err
	}
	return &tenant, nil
}

func (s *Store) GetTenantByCustomDomain(ctx context.Context, domain string) (*models.Tenant, error) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	var tenant models.Tenant
	err := s.C("tenants").FindOne(ctx, bson.M{"custom_domain": domain}).Decode(&tenant)
	if err != nil {
		return nil, err
	}
	return &tenant, nil
}

func (s *Store) ListTenants(ctx context.Context, filter bson.M) ([]models.Tenant, error) {
	if filter == nil {
		filter = bson.M{}
	}
	cursor, err := s.C("tenants").Find(ctx, filter, mongomodels.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var tenants []models.Tenant
	if err := cursor.All(ctx, &tenants); err != nil {
		return nil, err
	}
	return tenants, nil
}

func (s *Store) ListTenantsByOwner(ctx context.Context, ownerUserID primitive.ObjectID) ([]models.Tenant, error) {
	return s.ListTenants(ctx, bson.M{"owner_user_id": ownerUserID})
}

func (s *Store) PurgeTenantData(ctx context.Context, tenantID primitive.ObjectID) error {
	_, _ = s.C("tenant_form_submissions").DeleteMany(ctx, bson.M{"tenant_id": tenantID})
	_, _ = s.C("store_customers").DeleteMany(ctx, bson.M{"tenant_id": tenantID})
	_, err := s.C("tenants").DeleteOne(ctx, bson.M{"_id": tenantID})
	return err
}

func (s *Store) PurgeExpiredDeletedTenants(ctx context.Context) (int64, error) {
	now := time.Now()
	res, err := s.C("tenants").DeleteMany(ctx, bson.M{
		"is_deleted": true,
		"purge_at":   bson.M{"$lte": now, "$ne": nil},
	})
	if err != nil {
		return 0, err
	}
	return res.DeletedCount, nil
}

func (s *Store) UpdateTenant(ctx context.Context, id primitive.ObjectID, update bson.M) error {
	if update == nil {
		update = bson.M{}
	}
	update["updated_at"] = time.Now()
	_, err := s.C("tenants").UpdateByID(ctx, id, bson.M{"$set": update})
	return err
}

func (s *Store) DeleteTenant(ctx context.Context, id primitive.ObjectID) error {
	_, err := s.C("tenants").DeleteOne(ctx, bson.M{"_id": id})
	return err
}

func (s *Store) CreateTenantFormSubmission(ctx context.Context, submission *models.TenantFormSubmission) error {
	submission.ID = primitive.NewObjectID()
	submission.CreatedAt = time.Now()
	_, err := s.C("tenant_form_submissions").InsertOne(ctx, submission)
	return err
}

func (s *Store) ListTenantFormSubmissions(ctx context.Context, tenantID primitive.ObjectID, limit int64) ([]models.TenantFormSubmission, error) {
	opts := mongomodels.Find().SetSort(bson.D{{Key: "created_at", Value: -1}})
	if limit > 0 {
		opts.SetLimit(limit)
	}
	cursor, err := s.C("tenant_form_submissions").Find(ctx, bson.M{"tenant_id": tenantID}, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var list []models.TenantFormSubmission
	if err := cursor.All(ctx, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func (s *Store) CreateStoreCustomer(ctx context.Context, customer *models.StoreCustomer) error {
	customer.ID = primitive.NewObjectID()
	customer.Email = strings.ToLower(strings.TrimSpace(customer.Email))
	if customer.Status == "" {
		customer.Status = "active"
	}
	customer.CreatedAt = time.Now()
	_, err := s.C("store_customers").InsertOne(ctx, customer)
	return err
}

func (s *Store) GetStoreCustomerByEmail(ctx context.Context, tenantID primitive.ObjectID, email string) (*models.StoreCustomer, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var cust models.StoreCustomer
	err := s.C("store_customers").FindOne(ctx, bson.M{"tenant_id": tenantID, "email": email}).Decode(&cust)
	if err != nil {
		return nil, err
	}
	return &cust, nil
}
