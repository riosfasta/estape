package handlers

import (
	"reflect"
	"strings"
	"testing"

	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

func TestGroupMembersStayWithinSelectedResourcesAndActiveTeam(t *testing.T) {
	u, removed, blocked := primitive.NewObjectID(), primitive.NewObjectID(), primitive.NewObjectID()
	folder, domain, other := primitive.NewObjectID(), primitive.NewObjectID(), primitive.NewObjectID()
	g := models.TeamGroup{ID: primitive.NewObjectID(), WebsiteIDs: []primitive.ObjectID{domain}}
	team := models.Team{MemberIDs: []primitive.ObjectID{u, blocked}, Groups: []models.TeamGroup{g}, MemberGroups: map[string]string{u.Hex(): g.ID.Hex(), removed.Hex(): g.ID.Hex(), blocked.Hex(): g.ID.Hex()}}
	active := map[primitive.ObjectID]bool{u: true, removed: true}
	if got := groupMembersForResource(team, domain, true, active); !reflect.DeepEqual(got, []primitive.ObjectID{u}) {
		t.Fatalf("domain membership: %v", got)
	}
	if got := groupMembersForResource(team, folder, false, active); len(got) != 0 {
		t.Fatal("domain access leaked into folder")
	}
	if got := groupMembersForResource(team, other, true, active); len(got) != 0 {
		t.Fatal("access leaked into another domain")
	}
	delete(team.MemberGroups, u.Hex())
	if got := groupMembersForResource(team, domain, true, active); len(got) != 0 {
		t.Fatal("ungrouped user retained inherited access")
	}
}

// Evaluate the small set-expression subset used by our Mongo update pipelines.
// This tests permission transitions against the actual emitted expressions
// without a running database or sending notifications.
func evalAccessSet(t *testing.T, doc bson.M, expr any) []primitive.ObjectID {
	t.Helper()
	switch v := expr.(type) {
	case nil:
		return nil
	case string:
		return evalAccessSet(t, doc, doc[strings.TrimPrefix(v, "$")])
	case []primitive.ObjectID:
		return v
	case bson.A:
		out := []primitive.ObjectID{}
		for _, item := range v {
			out = append(out, item.(primitive.ObjectID))
		}
		return out
	case bson.M:
		for op, raw := range v {
			args := raw.(bson.A)
			left := evalAccessSet(t, doc, args[0])
			right := evalAccessSet(t, doc, args[1])
			switch op {
			case "$ifNull":
				if left == nil {
					return right
				}
				return left
			case "$setUnion":
				return uniqueObjectIDs(append(append([]primitive.ObjectID{}, left...), right...))
			case "$setDifference", "$setIntersection":
				out := []primitive.ObjectID{}
				for _, id := range left {
					if containsObjectID(right, id) == (op == "$setIntersection") {
						out = append(out, id)
					}
				}
				return out
			}
		}
	}
	t.Fatalf("unsupported expression: %#v", expr)
	return nil
}

func applyAccessUpdate(t *testing.T, doc bson.M, update mongo.Pipeline) {
	t.Helper()
	for _, stage := range update {
		for _, op := range stage {
			if op.Key != "$set" {
				continue
			}
			values := bson.M{}
			for field, expr := range op.Value.(bson.M) {
				if field != "updated_at" {
					values[field] = evalAccessSet(t, doc, expr)
				}
			}
			for field, value := range values {
				doc[field] = value
			}
		}
	}
}

func TestGroupAndDirectAccessOverlap(t *testing.T) {
	user, legacy := primitive.NewObjectID(), primitive.NewObjectID()
	doc := bson.M{"member_ids": []primitive.ObjectID{legacy}}
	applyAccessUpdate(t, doc, groupAccessUpdate([]primitive.ObjectID{user}))
	if !containsObjectID(doc["member_ids"].([]primitive.ObjectID), user) {
		t.Fatal("group member not granted access")
	}
	applyAccessUpdate(t, doc, directMemberAccessUpdate(user, true))
	applyAccessUpdate(t, doc, groupAccessUpdate(nil))
	if !containsObjectID(doc["member_ids"].([]primitive.ObjectID), user) {
		t.Fatal("removing group removed explicit individual grant")
	}
	applyAccessUpdate(t, doc, groupAccessUpdate([]primitive.ObjectID{user}))
	applyAccessUpdate(t, doc, directMemberAccessUpdate(user, false))
	if !containsObjectID(doc["member_ids"].([]primitive.ObjectID), user) {
		t.Fatal("removing direct access removed group grant")
	}
	applyAccessUpdate(t, doc, groupAccessUpdate(nil))
	if got := doc["member_ids"].([]primitive.ObjectID); !reflect.DeepEqual(got, []primitive.ObjectID{legacy}) {
		t.Fatalf("final grants should contain only untouched legacy member: %v", got)
	}
}

func TestGroupAccessRetriesAreIdempotent(t *testing.T) {
	u := primitive.NewObjectID()
	doc := bson.M{}
	for i := 0; i < 3; i++ {
		applyAccessUpdate(t, doc, groupAccessUpdate([]primitive.ObjectID{u}))
	}
	if got := doc["member_ids"].([]primitive.ObjectID); len(got) != 1 {
		t.Fatal("duplicate inherited grants")
	}
	for i := 0; i < 3; i++ {
		applyAccessUpdate(t, doc, groupAccessUpdate(nil))
	}
	if len(doc["member_ids"].([]primitive.ObjectID)) != 0 {
		t.Fatal("group removal retained access")
	}
}
