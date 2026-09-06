package handlers

import (
	"encoding/json"
	"strings"
	"testing"

	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestScopedJobAccessLifecycle(t *testing.T) {
	owner, freelancer, stranger := primitive.NewObjectID(), primitive.NewObjectID(), primitive.NewObjectID()
	job := models.MarketplaceJob{ID: primitive.NewObjectID(), OwnerID: owner, Status: "open"}
	proposal := models.MarketplaceProposal{JobID: job.ID, FreelancerID: freelancer, Kind: "invitation", Status: "offered"}
	for _, status := range []string{"offered", "accepted", "declined", "not_selected", "cancelled"} {
		proposal.Status = status
		read, write := scopedJobAccess(job, freelancer, &proposal)
		if read != (status == "offered" || status == "accepted") || write {
			t.Fatalf("invitation %s: read=%v write=%v", status, read, write)
		}
	}
	proposal.Status = "accepted"
	if read, write := scopedJobAccess(job, stranger, &proposal); read || write {
		t.Fatal("another user's proposal grants access")
	}
	proposal.JobID = primitive.NewObjectID()
	if read, _ := scopedJobAccess(job, freelancer, &proposal); read {
		t.Fatal("another job's proposal grants access")
	}
	proposal.JobID = job.ID
	proposal.Kind = "bid"
	if read, _ := scopedJobAccess(job, freelancer, &proposal); read {
		t.Fatal("public bidder can read private scope")
	}
	job.FreelancerID = freelancer
	for _, status := range []string{"hired", "submitted", "completed", "cancelled"} {
		job.Status = status
		read, write := scopedJobAccess(job, freelancer, nil)
		if read != (status != "cancelled") || write != (status == "hired" || status == "submitted") {
			t.Fatalf("hire %s: read=%v write=%v", status, read, write)
		}
		if read, write := scopedJobAccess(job, stranger, nil); read || write {
			t.Fatal("unrelated freelancer has task access")
		}
	}
}

func TestScopePricesAndPrivateSerialization(t *testing.T) {
	a, b := primitive.NewObjectID(), primitive.NewObjectID()
	valid := []marketplaceScopeRequest{{a.Hex(), 100}, {b.Hex(), 200}}
	if err := validateScopePricing(valid, "per_task", 300); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		tasks  []marketplaceScopeRequest
		mode   string
		budget int64
	}{
		{valid, "per_task", 301}, {valid, "domain", 300}, {valid, "invalid", 300},
		{nil, "domain", 300}, {[]marketplaceScopeRequest{{a.Hex(), 100}, {a.Hex(), 100}}, "per_task", 200},
		{[]marketplaceScopeRequest{{"bad", 100}}, "per_task", 100},
		{[]marketplaceScopeRequest{{a.Hex(), 99}}, "per_task", 99},
	} {
		if validateScopePricing(tc.tasks, tc.mode, tc.budget) == nil {
			t.Fatalf("accepted invalid pricing: %+v", tc)
		}
	}
	if err := validateScopePricing([]marketplaceScopeRequest{{a.Hex(), 0}}, "domain", 300); err != nil {
		t.Fatal(err)
	}
	job := models.MarketplaceJob{ScopeWebsiteID: b, ScopeTasks: []models.MarketplaceScopeTask{{TaskID: a, Content: "private-description"}}}
	if !scopedJobContains(job, a) || scopedJobContains(job, b) {
		t.Fatal("scope membership includes wrong task")
	}
	encoded, err := json.Marshal(job)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private-description") || strings.Contains(string(encoded), a.Hex()) || strings.Contains(string(encoded), b.Hex()) {
		t.Fatal("public job JSON exposes private scope")
	}
}

func TestInvitationChatPairIsolation(t *testing.T) {
	job := models.MarketplaceJob{ID: primitive.NewObjectID(), OwnerID: primitive.NewObjectID()}
	f, other := primitive.NewObjectID(), primitive.NewObjectID()
	p := models.MarketplaceProposal{JobID: job.ID, FreelancerID: f}
	if !chatPairAllowed(job, p, job.OwnerID, f) || !chatPairAllowed(job, p, f, f) {
		t.Fatal("participants cannot chat")
	}
	if chatPairAllowed(job, p, other, f) || chatPairAllowed(job, p, job.OwnerID, other) {
		t.Fatal("chat leaks across freelancers")
	}
	p.JobID = primitive.NewObjectID()
	if chatPairAllowed(job, p, f, f) {
		t.Fatal("chat leaks across jobs")
	}
}
