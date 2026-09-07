package handlers

import (
	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"reflect"
	"testing"
	"time"
)

func TestChatDeletionChangesOnlyCurrentAccount(t *testing.T) {
	user := primitive.NewObjectID()
	expected := bson.M{"$addToSet": bson.M{"hidden_for": user}}
	if got := chatHiddenUpdate(user, true); !reflect.DeepEqual(got, expected) {
		t.Fatalf("delete must only hide for caller: %#v", got)
	}
	expected = bson.M{"$pull": bson.M{"hidden_for": user}}
	if got := chatHiddenUpdate(user, false); !reflect.DeepEqual(got, expected) {
		t.Fatalf("restore must only unhide caller: %#v", got)
	}
}

func TestReadChatThroughDoesNotReadNewerMessages(t *testing.T) {
	user, chat, msgID := primitive.NewObjectID(), primitive.NewObjectID(), primitive.NewObjectID()
	stamp := time.Now()
	got := readChatThroughFilter(user, chat, models.Message{ID: msgID, SentAt: stamp})
	want := bson.A{bson.M{"sent_at": bson.M{"$lt": stamp}}, bson.M{"sent_at": stamp, "_id": bson.M{"$lte": msgID}}}
	if !reflect.DeepEqual(got["$or"], want) {
		t.Fatalf("read boundary must stop at displayed message: %#v", got)
	}
}

func TestChatUnreadFilterIsScopedToViewerAndChats(t *testing.T) {
	user, chat := primitive.NewObjectID(), primitive.NewObjectID()
	want := bson.M{"chat_id": bson.M{"$in": []primitive.ObjectID{chat}}, "sender_id": bson.M{"$ne": user}, "read_by": bson.M{"$ne": user}}
	if got := unreadChatFilter(user, []primitive.ObjectID{chat}); !reflect.DeepEqual(got, want) {
		t.Fatalf("incorrect unread scope: %#v", got)
	}
}
