package handlers

import (
	"encoding/json"
	"testing"
	"time"

	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestTimeEntryModelAndSerialization(t *testing.T) {
	now := time.Now().UTC()
	end := now.Add(45 * time.Minute)
	entry := models.TimeEntry{
		ID:              primitive.NewObjectID(),
		TaskID:          primitive.NewObjectID(),
		UserID:          primitive.NewObjectID(),
		TeamID:          primitive.NewObjectID(),
		StartTime:       now,
		EndTime:         &end,
		DurationMinutes: 45,
		DurationSeconds: 2700,
		Billable:        true,
		UserName:        "Jane Doe",
		UserEmail:       "jane@example.com",
		CreatedAt:       now,
	}

	data, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("failed to marshal TimeEntry: %v", err)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal TimeEntry: %v", err)
	}

	if decoded["user_name"] != "Jane Doe" {
		t.Errorf("expected user_name 'Jane Doe', got %v", decoded["user_name"])
	}
	if decoded["user_email"] != "jane@example.com" {
		t.Errorf("expected user_email 'jane@example.com', got %v", decoded["user_email"])
	}
	if decoded["duration_seconds"] != float64(2700) {
		t.Errorf("expected duration_seconds 2700, got %v", decoded["duration_seconds"])
	}
	if decoded["duration_minutes"] != float64(45) {
		t.Errorf("expected duration_minutes 45, got %v", decoded["duration_minutes"])
	}
	if decoded["billable"] != true {
		t.Errorf("expected billable true, got %v", decoded["billable"])
	}
}

func TestActiveTimerFilter(t *testing.T) {
	userID := primitive.NewObjectID()
	filter := activeTimerFilter(userID)
	if filter["user_id"] != userID {
		t.Errorf("expected user_id in activeTimerFilter, got %v", filter["user_id"])
	}
	orConditions, ok := filter["$or"].([]bson.M)
	if !ok || len(orConditions) != 2 {
		t.Fatalf("expected 2 $or conditions, got %v", filter["$or"])
	}
}

func TestUniqueObjectIDs(t *testing.T) {
	id1 := primitive.NewObjectID()
	id2 := primitive.NewObjectID()
	ids := []primitive.ObjectID{id1, id2, id1, primitive.NilObjectID, id2}
	unique := uniqueObjectIDs(ids)
	if len(unique) != 2 {
		t.Fatalf("expected 2 unique IDs, got %d", len(unique))
	}
	if unique[0] != id1 || unique[1] != id2 {
		t.Errorf("unexpected IDs in uniqueObjectIDs: %v", unique)
	}
}

func TestBoolText(t *testing.T) {
	if boolText(true) != "true" {
		t.Errorf("expected 'true', got %s", boolText(true))
	}
	if boolText(false) != "false" {
		t.Errorf("expected 'false', got %s", boolText(false))
	}
}

func TestTimerDurationCalculation(t *testing.T) {
	start := time.Now().Add(-125 * time.Second)
	now := time.Now()
	seconds := int64(now.Sub(start) / time.Second)
	if seconds < 124 || seconds > 126 {
		t.Errorf("unexpected seconds: %d", seconds)
	}
	durationMinutes := int((seconds + 59) / 60)
	if durationMinutes != 3 {
		t.Errorf("expected durationMinutes 3 for ~125s, got %d", durationMinutes)
	}

	shortStart := time.Now().Add(-20 * time.Second)
	shortSeconds := int64(time.Now().Sub(shortStart) / time.Second)
	shortMinutes := int((shortSeconds + 59) / 60)
	if shortMinutes != 1 {
		t.Errorf("expected 1 minute minimum for 20s, got %d", shortMinutes)
	}
}
