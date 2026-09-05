package handlers

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"bugmark/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func userUploadDir(userID primitive.ObjectID) string {
	return filepath.Join("users", userID.Hex())
}

func userUploadURLPrefix(userID primitive.ObjectID) string {
	return "/uploads/users/" + userID.Hex() + "/"
}

func (s *Server) deleteUserUploadFolder(userID primitive.ObjectID) error {
	if userID.IsZero() {
		return nil
	}
	base, err := filepath.Abs(s.cfg.UploadDir)
	if err != nil {
		return err
	}
	target, err := filepath.Abs(filepath.Join(s.cfg.UploadDir, userUploadDir(userID)))
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(base, target)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return errors.New("upload directory is outside configured upload root")
	}
	return os.RemoveAll(target)
}

func (s *Server) cleanupDeletedUser(ctx context.Context, user models.User) error {
	if err := s.cleanupMarketplaceUser(ctx, user.ID); err != nil {
		return err
	}
	ownedTeams, err := s.ownedTeamsForDeletedUser(ctx, user.ID)
	if err != nil {
		return err
	}
	ownedTeamIDs := make([]primitive.ObjectID, 0, len(ownedTeams))
	ownedSubscriptionIDs := make([]primitive.ObjectID, 0, len(ownedTeams))
	for _, team := range ownedTeams {
		if !team.ID.IsZero() && !containsObjectID(ownedTeamIDs, team.ID) {
			ownedTeamIDs = append(ownedTeamIDs, team.ID)
		}
		if !team.SubscriptionID.IsZero() && !containsObjectID(ownedSubscriptionIDs, team.SubscriptionID) {
			ownedSubscriptionIDs = append(ownedSubscriptionIDs, team.SubscriptionID)
		}
		s.deleteLocalUploadFile(team.LogoURL)
	}
	if err := s.cleanupOwnedTeams(ctx, ownedTeamIDs, ownedSubscriptionIDs); err != nil {
		return err
	}
	if err := s.cleanupUserReferences(ctx, user); err != nil {
		return err
	}
	if err := s.cleanupUserUploadedReferences(ctx, user.ID); err != nil {
		return err
	}
	s.deleteLocalUploadFile(user.AvatarURL)
	return s.deleteUserUploadFolder(user.ID)
}

func (s *Server) cleanupMarketplaceUser(ctx context.Context, id primitive.ObjectID) error {
	return s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
		var wallet models.MarketplaceWallet
		err := s.store.C("marketplace_wallets").FindOne(sc, bson.M{"_id": id}).Decode(&wallet)
		if err != nil && err != mongo.ErrNoDocuments {
			return err
		}
		if wallet.Deposits != 0 || wallet.Earnings != 0 || wallet.Pending != 0 || wallet.Reserved != 0 {
			return errors.New("settle marketplace funds before deleting this account")
		}
		count, err := s.store.C("marketplace_transfers").CountDocuments(sc, bson.M{"user_id": id, "status": bson.M{"$in": []string{"requested", "pending", "creating"}}})
		if err != nil {
			return err
		}
		if count > 0 {
			return errors.New("resolve pending marketplace payments before deleting this account")
		}
		count, err = s.store.C("marketplace_jobs").CountDocuments(sc, bson.M{"$or": []bson.M{{"owner_id": id}, {"freelancer_id": id}}, "status": bson.M{"$in": []string{"hired", "submitted"}}})
		if err != nil {
			return err
		}
		if count > 0 {
			return errors.New("complete active marketplace contracts before deleting this account")
		}
		_, err = s.store.C("marketplace_jobs").UpdateMany(sc, bson.M{"owner_id": id, "status": "open"}, bson.M{"$set": bson.M{"status": "cancelled"}})
		if err != nil {
			return err
		}
		for _, collection := range []string{"freelancer_profiles", "marketplace_identity"} {
			if _, err := s.store.C(collection).DeleteOne(sc, bson.M{"_id": id}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Server) ownedTeamsForDeletedUser(ctx context.Context, userID primitive.ObjectID) ([]models.Team, error) {
	cursor, err := s.store.C("teams").Find(ctx, bson.M{"owner_admin_id": userID})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	teams := []models.Team{}
	if err := cursor.All(ctx, &teams); err != nil {
		return nil, err
	}
	return teams, nil
}

func (s *Server) cleanupOwnedTeams(ctx context.Context, teamIDs []primitive.ObjectID, subscriptionIDs []primitive.ObjectID) error {
	if len(teamIDs) == 0 {
		return nil
	}
	if err := s.deleteTeamWorkspaceData(ctx, teamIDs); err != nil {
		return err
	}
	if _, err := s.store.C("client_task_logs").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_task_comments").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_tasks").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_tabs").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_documents").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_websites").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_projects").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	if err := s.deleteTeamChats(ctx, teamIDs); err != nil {
		return err
	}
	for _, collection := range []string{"time_entries", "integrations", "import_jobs", "export_jobs", "team_invitations"} {
		if _, err := s.store.C(collection).DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
			return err
		}
	}
	invoiceFilter := bson.M{"team_id": bson.M{"$in": teamIDs}}
	if len(subscriptionIDs) > 0 {
		invoiceFilter = bson.M{"$or": []bson.M{{"team_id": bson.M{"$in": teamIDs}}, {"subscription_id": bson.M{"$in": subscriptionIDs}}}}
	}
	if _, err := s.store.C("invoices").DeleteMany(ctx, invoiceFilter); err != nil {
		return err
	}
	if _, err := s.store.C("subscriptions").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	if len(subscriptionIDs) > 0 {
		if _, err := s.store.C("subscriptions").DeleteMany(ctx, bson.M{"_id": bson.M{"$in": subscriptionIDs}}); err != nil {
			return err
		}
	}
	_, _ = s.store.C("notifications").DeleteMany(ctx, bson.M{"related_id": bson.M{"$in": teamIDs}})
	if _, err := s.store.C("teams").DeleteMany(ctx, bson.M{"_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	return nil
}

func (s *Server) deleteTeamWorkspaceData(ctx context.Context, teamIDs []primitive.ObjectID) error {
	websiteIDs, err := s.idsByFilter(ctx, "websites", bson.M{"team_id": bson.M{"$in": teamIDs}})
	if err != nil {
		return err
	}
	if len(websiteIDs) > 0 {
		if _, err := s.store.C("bugs").DeleteMany(ctx, bson.M{"website_id": bson.M{"$in": websiteIDs}}); err != nil {
			return err
		}
	}
	if _, err := s.store.C("websites").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	spaceIDs, err := s.idsByFilter(ctx, "spaces", bson.M{"team_id": bson.M{"$in": teamIDs}})
	if err != nil {
		return err
	}
	projectIDs, err := s.idsByFilter(ctx, "projects", bson.M{"space_id": bson.M{"$in": spaceIDs}})
	if err != nil {
		return err
	}
	listIDs, err := s.idsByFilter(ctx, "lists", bson.M{"project_id": bson.M{"$in": projectIDs}})
	if err != nil {
		return err
	}
	if len(listIDs) > 0 {
		if _, err := s.store.C("tasks").DeleteMany(ctx, bson.M{"list_id": bson.M{"$in": listIDs}}); err != nil {
			return err
		}
	}
	if len(projectIDs) > 0 {
		if _, err := s.store.C("lists").DeleteMany(ctx, bson.M{"project_id": bson.M{"$in": projectIDs}}); err != nil {
			return err
		}
		if _, err := s.store.C("projects").DeleteMany(ctx, bson.M{"_id": bson.M{"$in": projectIDs}}); err != nil {
			return err
		}
	}
	if _, err := s.store.C("spaces").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	return nil
}

func (s *Server) cleanupUserReferences(ctx context.Context, user models.User) error {
	id := user.ID
	email := strings.ToLower(strings.TrimSpace(user.Email))
	if err := s.deleteUserChats(ctx, id); err != nil {
		return err
	}
	if _, err := s.store.C("messages").DeleteMany(ctx, bson.M{"sender_id": id}); err != nil {
		return err
	}
	for _, collection := range []string{"notifications", "push_devices", "time_entries", "client_task_comments", "client_task_logs", "audit_logs", "password_update_otps"} {
		filter := bson.M{"user_id": id}
		switch collection {
		case "notifications":
			filter = bson.M{"$or": []bson.M{{"user_id": id}, {"related_id": id}}}
		case "client_task_comments":
			filter = bson.M{"author_id": id}
		case "client_task_logs":
			filter = bson.M{"actor_id": id}
		case "audit_logs":
			filter = bson.M{"$or": []bson.M{{"actor_id": id}, {"target_id": id}}}
		}
		if _, err := s.store.C(collection).DeleteMany(ctx, filter); err != nil {
			return err
		}
	}
	inviteOr := []bson.M{{"existing_user_id": id}, {"invited_by": id}}
	if email != "" {
		inviteOr = append(inviteOr, bson.M{"email": email})
	}
	if _, err := s.store.C("team_invitations").DeleteMany(ctx, bson.M{"$or": inviteOr}); err != nil {
		return err
	}
	if email != "" {
		if _, err := s.store.C("email_queue").DeleteMany(ctx, bson.M{"recipient": email}); err != nil {
			return err
		}
	}
	if _, err := s.store.C("teams").UpdateMany(ctx, bson.M{}, bson.M{"$pull": bson.M{"member_ids": id}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_projects").UpdateMany(ctx, bson.M{}, bson.M{
		"$pull":  bson.M{"member_ids": id, "client_admin_ids": id},
		"$unset": bson.M{clientAccessRoleField(id): ""},
	}); err != nil {
		return err
	}
	if _, err := s.store.C("client_websites").UpdateMany(ctx, bson.M{}, bson.M{
		"$pull":  bson.M{"member_ids": id, "client_admin_ids": id},
		"$unset": bson.M{clientAccessRoleField(id): ""},
	}); err != nil {
		return err
	}
	if _, err := s.store.C("tasks").UpdateMany(ctx, bson.M{}, bson.M{"$pull": bson.M{"assignee_ids": id, "comments": bson.M{"author_id": id}}}); err != nil {
		return err
	}
	if _, err := s.store.C("bugs").UpdateMany(ctx, bson.M{}, bson.M{"$pull": bson.M{"assignee_ids": id, "comments": bson.M{"author_id": id}}}); err != nil {
		return err
	}
	if _, err := s.store.C("bugs").UpdateMany(ctx, bson.M{"assignee_id": id}, bson.M{"$unset": bson.M{"assignee_id": ""}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_tasks").UpdateMany(ctx, bson.M{}, bson.M{"$pull": bson.M{"assignee_ids": id}}); err != nil {
		return err
	}
	if err := s.cleanupNestedUserReferences(ctx, id); err != nil {
		return err
	}
	for _, collection := range []string{"client_projects", "client_websites", "client_documents", "client_tabs", "client_tasks", "websites", "bugs", "tasks", "import_jobs", "export_jobs"} {
		if _, err := s.store.C(collection).UpdateMany(ctx, bson.M{"created_by": id}, bson.M{"$set": bson.M{"created_by": primitive.NilObjectID}}); err != nil {
			return err
		}
	}
	if _, err := s.store.C("static_pages").UpdateMany(ctx, bson.M{"updated_by": id}, bson.M{"$set": bson.M{"updated_by": primitive.NilObjectID}}); err != nil {
		return err
	}
	pageVersionOptions := options.Update().SetArrayFilters(options.ArrayFilters{Filters: []interface{}{bson.M{"version.created_by": id}}})
	if _, err := s.store.C("static_pages").UpdateMany(
		ctx,
		bson.M{"versions.created_by": id},
		bson.M{"$set": bson.M{"versions.$[version].created_by": primitive.NilObjectID}},
		pageVersionOptions,
	); err != nil {
		return err
	}
	if _, err := s.store.C("integrations").DeleteMany(ctx, bson.M{"connected_by": id}); err != nil {
		return err
	}
	return nil
}

func (s *Server) cleanupNestedUserReferences(ctx context.Context, userID primitive.ObjectID) error {
	if _, err := s.store.C("messages").UpdateMany(ctx, bson.M{"read_by": userID}, bson.M{"$pull": bson.M{"read_by": userID}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_task_comments").UpdateMany(ctx, bson.M{"read_by": userID}, bson.M{"$pull": bson.M{"read_by": userID}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_task_comments").UpdateMany(ctx, bson.M{"reactions.user_ids": userID}, bson.M{"$pull": bson.M{"reactions.$[].user_ids": userID}}); err != nil {
		return err
	}
	if _, err := s.store.C("tasks").UpdateMany(ctx, bson.M{"comments.read_by": userID}, bson.M{"$pull": bson.M{"comments.$[].read_by": userID}}); err != nil {
		return err
	}
	if _, err := s.store.C("bugs").UpdateMany(ctx, bson.M{"comments.read_by": userID}, bson.M{"$pull": bson.M{"comments.$[].read_by": userID}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_tasks").UpdateMany(ctx, bson.M{"annotations.assignee_ids": userID}, bson.M{"$pull": bson.M{"annotations.$[].assignee_ids": userID}}); err != nil {
		return err
	}
	annotationCreatorOptions := options.Update().SetArrayFilters(options.ArrayFilters{Filters: []interface{}{bson.M{"annotation.created_by": userID}}})
	if _, err := s.store.C("client_tasks").UpdateMany(
		ctx,
		bson.M{"annotations.created_by": userID},
		bson.M{"$set": bson.M{"annotations.$[annotation].created_by": primitive.NilObjectID}},
		annotationCreatorOptions,
	); err != nil {
		return err
	}
	return nil
}

func (s *Server) cleanupUserUploadedReferences(ctx context.Context, userID primitive.ObjectID) error {
	pattern := "^" + regexp.QuoteMeta(userUploadURLPrefix(userID))
	urlFilter := bson.M{"$regex": pattern}
	for _, collection := range []string{"tasks", "client_tasks", "bugs"} {
		if _, err := s.store.C(collection).UpdateMany(ctx, bson.M{}, bson.M{"$pull": bson.M{"attachments": urlFilter}}); err != nil {
			return err
		}
	}
	for _, spec := range []struct {
		Collection string
		Field      string
	}{
		{"users", "avatar_url"},
		{"teams", "logo_url"},
		{"site_settings", "logo_url"},
		{"site_settings", "favicon_url"},
		{"websites", "screenshot_url"},
		{"bugs", "screenshot_url"},
		{"client_tasks", "screenshot_url"},
	} {
		if _, err := s.store.C(spec.Collection).UpdateMany(ctx, bson.M{spec.Field: urlFilter}, bson.M{"$unset": bson.M{spec.Field: ""}}); err != nil {
			return err
		}
	}
	for _, spec := range []struct {
		Collection string
		Field      string
	}{
		{"client_documents", "file_url"},
		{"client_task_comments", "attachment_url"},
		{"messages", "attachment_url"},
	} {
		if _, err := s.store.C(spec.Collection).DeleteMany(ctx, bson.M{spec.Field: urlFilter}); err != nil {
			return err
		}
	}
	if _, err := s.store.C("bugs").UpdateMany(ctx, bson.M{}, bson.M{"$pull": bson.M{"comments": bson.M{"attachment_url": urlFilter}}}); err != nil {
		return err
	}
	if _, err := s.store.C("tasks").UpdateMany(ctx, bson.M{}, bson.M{"$pull": bson.M{"comments": bson.M{"attachment_url": urlFilter}}}); err != nil {
		return err
	}
	if _, err := s.store.C("client_tasks").UpdateMany(ctx, bson.M{"annotations.attachments": urlFilter}, bson.M{"$pull": bson.M{"annotations.$[].attachments": urlFilter}}); err != nil {
		return err
	}
	screenshotOptions := options.Update().SetArrayFilters(options.ArrayFilters{Filters: []interface{}{bson.M{"annotation.screenshot_url": urlFilter}}})
	if _, err := s.store.C("client_tasks").UpdateMany(
		ctx,
		bson.M{"annotations.screenshot_url": urlFilter},
		bson.M{"$unset": bson.M{"annotations.$[annotation].screenshot_url": ""}},
		screenshotOptions,
	); err != nil {
		return err
	}
	if err := s.cleanupStaticPageUploadReferences(ctx, pattern); err != nil {
		return err
	}
	return nil
}

func (s *Server) cleanupStaticPageUploadReferences(ctx context.Context, pattern string) error {
	urlRegexp := primitive.Regex{Pattern: pattern, Options: ""}
	cursor, err := s.store.C("static_pages").Find(ctx, bson.M{
		"$or": []bson.M{
			{"blocks.props.url": urlRegexp},
			{"versions.blocks.props.url": urlRegexp},
		},
	})
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)
	for cursor.Next(ctx) {
		var page models.StaticPage
		if err := cursor.Decode(&page); err != nil {
			return err
		}
		changed := scrubPageBlockUploadURLs(page.Blocks, pattern)
		for index := range page.Versions {
			if scrubPageBlockUploadURLs(page.Versions[index].Blocks, pattern) {
				changed = true
			}
		}
		if !changed {
			continue
		}
		if _, err := s.store.C("static_pages").UpdateByID(ctx, page.ID, bson.M{"$set": bson.M{
			"blocks":     page.Blocks,
			"versions":   page.Versions,
			"updated_at": page.UpdatedAt,
		}}); err != nil {
			return err
		}
	}
	return cursor.Err()
}

func scrubPageBlockUploadURLs(blocks []models.PageBlock, pattern string) bool {
	changed := false
	for index := range blocks {
		if urlValue, ok := blocks[index].Props["url"].(string); ok {
			matched, _ := regexp.MatchString(pattern, urlValue)
			if matched {
				blocks[index].Props["url"] = ""
				changed = true
			}
		}
		if len(blocks[index].Children) > 0 && scrubPageBlockUploadURLs(blocks[index].Children, pattern) {
			changed = true
		}
	}
	return changed
}

func (s *Server) deleteUserChats(ctx context.Context, userID primitive.ObjectID) error {
	chatIDs, err := s.idsByFilter(ctx, "chats", bson.M{"$or": []bson.M{{"participant_ids": userID}, {"created_by": userID}, {"ended_by": userID}, {"deleted_by": userID}}})
	if err != nil {
		return err
	}
	if len(chatIDs) == 0 {
		return nil
	}
	if _, err := s.store.C("messages").DeleteMany(ctx, bson.M{"chat_id": bson.M{"$in": chatIDs}}); err != nil {
		return err
	}
	if _, err := s.store.C("chats").DeleteMany(ctx, bson.M{"_id": bson.M{"$in": chatIDs}}); err != nil {
		return err
	}
	return nil
}

func (s *Server) deleteTeamChats(ctx context.Context, teamIDs []primitive.ObjectID) error {
	chatIDs, err := s.idsByFilter(ctx, "chats", bson.M{"team_id": bson.M{"$in": teamIDs}})
	if err != nil {
		return err
	}
	if len(chatIDs) > 0 {
		if _, err := s.store.C("messages").DeleteMany(ctx, bson.M{"chat_id": bson.M{"$in": chatIDs}}); err != nil {
			return err
		}
	}
	if _, err := s.store.C("chats").DeleteMany(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}); err != nil {
		return err
	}
	return nil
}

func (s *Server) idsByFilter(ctx context.Context, collection string, filter bson.M) ([]primitive.ObjectID, error) {
	cursor, err := s.store.C(collection).Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	ids := []primitive.ObjectID{}
	for cursor.Next(ctx) {
		var row struct {
			ID primitive.ObjectID `bson:"_id"`
		}
		if err := cursor.Decode(&row); err != nil {
			return nil, err
		}
		if !row.ID.IsZero() && !containsObjectID(ids, row.ID) {
			ids = append(ids, row.ID)
		}
	}
	return ids, cursor.Err()
}
