package handlers

import (
	"context"

	"bugmark/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var clientTaskNotificationTypes = []string{
	"client_task_assigned",
	"client_task_updated",
	"client_task_mention",
	"client_task_comment",
	"client_task_comment_mention",
	"client_task_comment_reaction",
}

var taskNotificationTypes = []string{
	"task_assigned",
	"task_updated",
	"task_comment",
	"task_mention",
	"comment_mention",
}

func removedObjectIDs(previous []primitive.ObjectID, next []primitive.ObjectID) []primitive.ObjectID {
	removed := []primitive.ObjectID{}
	for _, id := range uniqueObjectIDs(previous) {
		if !id.IsZero() && !containsObjectID(next, id) {
			removed = append(removed, id)
		}
	}
	return removed
}

func (s *Server) deleteNotificationsByRelatedIDs(ctx context.Context, relatedIDs []primitive.ObjectID, notificationTypes ...string) {
	ids := uniqueObjectIDs(relatedIDs)
	if len(ids) == 0 {
		return
	}
	filter := bson.M{"related_id": bson.M{"$in": ids}}
	if len(notificationTypes) > 0 {
		filter["type"] = bson.M{"$in": notificationTypes}
	}
	_, _ = s.store.C("notifications").DeleteMany(ctx, filter)
}

func (s *Server) deleteNotificationsForUsers(ctx context.Context, userIDs []primitive.ObjectID, relatedID primitive.ObjectID, notificationTypes ...string) {
	users := uniqueObjectIDs(userIDs)
	if len(users) == 0 || relatedID.IsZero() {
		return
	}
	filter := bson.M{
		"user_id":    bson.M{"$in": users},
		"related_id": relatedID,
	}
	if len(notificationTypes) > 0 {
		filter["type"] = bson.M{"$in": notificationTypes}
	}
	_, _ = s.store.C("notifications").DeleteMany(ctx, filter)
}

func (s *Server) deleteClientTaskNotificationsForFilter(ctx context.Context, filter bson.M) {
	relatedIDs := []primitive.ObjectID{}
	taskCursor, err := s.store.C("client_tasks").Find(ctx, filter, options.Find().SetProjection(bson.M{"_id": 1}))
	if err == nil {
		defer taskCursor.Close(ctx)
		for taskCursor.Next(ctx) {
			var row struct {
				ID primitive.ObjectID `bson:"_id"`
			}
			if taskCursor.Decode(&row) == nil && !row.ID.IsZero() {
				relatedIDs = append(relatedIDs, row.ID)
			}
		}
	}
	commentCursor, err := s.store.C("client_task_comments").Find(ctx, filter, options.Find().SetProjection(bson.M{"_id": 1}))
	if err == nil {
		defer commentCursor.Close(ctx)
		for commentCursor.Next(ctx) {
			var row struct {
				ID primitive.ObjectID `bson:"_id"`
			}
			if commentCursor.Decode(&row) == nil && !row.ID.IsZero() {
				relatedIDs = append(relatedIDs, row.ID)
			}
		}
	}
	s.deleteNotificationsByRelatedIDs(ctx, relatedIDs, clientTaskNotificationTypes...)
}

func (s *Server) deleteClientCommentReactionNotification(ctx context.Context, comment models.ClientTaskComment, actorID primitive.ObjectID, emoji string) {
	if comment.ID.IsZero() || comment.AuthorID.IsZero() || comment.AuthorID == actorID {
		return
	}
	filter := bson.M{
		"user_id":    comment.AuthorID,
		"related_id": comment.ID,
		"type":       "client_task_comment_reaction",
		"content":    trimForNotification(s.notificationActorMention(ctx, actorID) + " has given reaction " + clientReactionLabel(emoji) + " to your comment"),
	}
	_, _ = s.store.C("notifications").DeleteMany(ctx, filter)
}
