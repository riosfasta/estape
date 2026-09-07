package handlers

import (
	"context"
	"errors"

	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Never promote domain-only access to membership of its parent folder.
func invitationAccessFilter(teamID primitive.ObjectID, ids []primitive.ObjectID) bson.M {
	return bson.M{"team_id": teamID, "_id": bson.M{"$in": uniqueObjectIDs(ids)}}
}

func (s *Server) validateInvitationAccess(ctx context.Context, teamID primitive.ObjectID, clientIDs, websiteIDs []primitive.ObjectID) error {
	if len(clientIDs)+len(websiteIDs) > 500 {
		return errors.New("select up to 500 folders and domains per invitation")
	}
	for collection, ids := range map[string][]primitive.ObjectID{"client_projects": clientIDs, "client_websites": websiteIDs} {
		if len(ids) == 0 {
			continue
		}
		for _, id := range ids {
			if id.IsZero() {
				return errors.New("invalid folder or domain ID")
			}
		}
		count, err := s.store.C(collection).CountDocuments(ctx, invitationAccessFilter(teamID, ids))
		if err != nil {
			return errors.New("could not validate folder and domain access")
		}
		if count != int64(len(uniqueObjectIDs(ids))) {
			return errors.New("selected folders and domains must belong to this company")
		}
	}
	return nil
}

func (s *Server) grantInvitationAccess(ctx context.Context, invitation models.TeamInvitation, userID primitive.ObjectID) error {
	for collection, ids := range map[string][]primitive.ObjectID{"client_projects": invitation.ClientIDs, "client_websites": invitation.WebsiteIDs} {
		if len(ids) == 0 {
			continue
		}
		// Idempotent so a failed acceptance can be safely retried.
		result, err := s.store.C(collection).UpdateMany(ctx, invitationAccessFilter(invitation.TeamID, ids), bson.M{
			"$addToSet": bson.M{"member_ids": userID},
			"$pull": bson.M{"group_only_member_ids": userID},
			"$set":      bson.M{"member_roles." + userID.Hex(): firstNonEmpty(invitation.StaffRole, "internal")},
		})
		if err != nil {
			return err
		}
		if result.MatchedCount != int64(len(uniqueObjectIDs(ids))) {
			return errors.New("selected access is no longer available")
		}
	}
	return nil
}
