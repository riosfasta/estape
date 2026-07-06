package email

import (
	"context"
	"log"
	"net/smtp"
	"time"

	"bugmark/internal/config"
	"bugmark/internal/models"
	"bugmark/internal/store"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Worker struct {
	cfg   config.Config
	store *store.Store
}

func NewWorker(cfg config.Config, store *store.Store) *Worker {
	return &Worker{cfg: cfg, store: store}
}

func (w *Worker) Start(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.process(ctx)
		}
	}
}

func (w *Worker) Enqueue(ctx context.Context, item models.EmailQueueItem) error {
	item.ID = primitive.NewObjectID()
	item.Status = "pending"
	item.CreatedAt = time.Now()
	_, err := w.store.C("email_queue").InsertOne(ctx, item)
	return err
}

func (w *Worker) process(ctx context.Context) {
	cursor, err := w.store.C("email_queue").Find(ctx, bson.M{"status": "pending"})
	if err != nil {
		log.Printf("email queue find: %v", err)
		return
	}
	defer cursor.Close(ctx)

	for cursor.Next(ctx) {
		var item models.EmailQueueItem
		if err := cursor.Decode(&item); err != nil {
			continue
		}
		status := "sent"
		errMsg := ""
		if err := w.send(item); err != nil {
			status = "failed"
			errMsg = err.Error()
		}
		now := time.Now()
		_, _ = w.store.C("email_queue").UpdateByID(ctx, item.ID, bson.M{"$set": bson.M{"status": status, "sent_at": now, "error": errMsg}})
	}
}

func (w *Worker) send(item models.EmailQueueItem) error {
	if w.cfg.SMTPHost == "" || w.cfg.SMTPUser == "" {
		log.Printf("email queued to %s [%s]: %s", item.Recipient, item.Type, item.Subject)
		return nil
	}
	auth := smtp.PlainAuth("", w.cfg.SMTPUser, w.cfg.SMTPPassword, w.cfg.SMTPHost)
	msg := []byte("To: " + item.Recipient + "\r\n" +
		"Subject: " + item.Subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=UTF-8\r\n\r\n" +
		item.BodyHTML)
	return smtp.SendMail(w.cfg.SMTPHost+":"+w.cfg.SMTPPort, auth, w.cfg.SMTPFrom, []string{item.Recipient}, msg)
}
