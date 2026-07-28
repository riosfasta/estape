package email

import (
	"context"
	"crypto/tls"
	"errors"
	"log"
	"net"
	"net/smtp"
	"strings"
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

const smtpSendTimeout = 20 * time.Second

type smtpRuntimeConfig struct {
	Enabled  bool
	Host     string
	Port     string
	User     string
	Password string
	From     string
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

func (w *Worker) CanSend(ctx context.Context) bool {
	_, err := w.readySMTPConfig(ctx)
	return err == nil
}

func (w *Worker) SendNow(ctx context.Context, item models.EmailQueueItem) error {
	cfg, err := w.readySMTPConfig(ctx)
	if err != nil {
		return err
	}
	return w.sendWithConfig(ctx, cfg, item)
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
		if err := w.send(ctx, item); err != nil {
			status = "failed"
			errMsg = err.Error()
		}
		now := time.Now()
		_, _ = w.store.C("email_queue").UpdateByID(ctx, item.ID, bson.M{"$set": bson.M{"status": status, "sent_at": now, "error": errMsg}})
	}
}

func (w *Worker) send(ctx context.Context, item models.EmailQueueItem) error {
	cfg := w.smtpConfig(ctx)
	if !cfg.Enabled || cfg.Host == "" || cfg.User == "" {
		log.Printf("email queued to %s [%s]: %s", item.Recipient, item.Type, item.Subject)
		return nil
	}
	if strings.TrimSpace(cfg.From) == "" {
		cfg.From = cfg.User
	}
	return w.sendWithConfig(ctx, cfg, item)
}

func (w *Worker) readySMTPConfig(ctx context.Context) (smtpRuntimeConfig, error) {
	cfg := w.smtpConfig(ctx)
	if !cfg.Enabled {
		return cfg, errors.New("SMTP delivery is disabled")
	}
	if strings.TrimSpace(cfg.Host) == "" {
		return cfg, errors.New("SMTP host is required")
	}
	if strings.TrimSpace(cfg.User) == "" {
		return cfg, errors.New("SMTP username is required")
	}
	if strings.TrimSpace(cfg.From) == "" {
		cfg.From = cfg.User
	}
	return cfg, nil
}

func (w *Worker) sendWithConfig(ctx context.Context, cfg smtpRuntimeConfig, item models.EmailQueueItem) error {
	ctx, cancel := context.WithTimeout(ctx, smtpSendTimeout)
	defer cancel()
	host, port := smtpHostPort(cfg)
	addr := net.JoinHostPort(host, port)
	dialer := &net.Dialer{Timeout: smtpSendTimeout}
	var conn net.Conn
	var err error
	if port == "465" {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(smtpSendTimeout))
	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if port != "465" {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
				return err
			}
		}
	}
	auth := smtp.PlainAuth("", cfg.User, cfg.Password, host)
	if err := client.Auth(auth); err != nil {
		return err
	}
	from := firstNonEmpty(strings.TrimSpace(cfg.From), strings.TrimSpace(cfg.User))
	if err := client.Mail(from); err != nil {
		return err
	}
	if err := client.Rcpt(strings.TrimSpace(item.Recipient)); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	subject := strings.NewReplacer("\r", " ", "\n", " ").Replace(item.Subject)
	msg := []byte("To: " + item.Recipient + "\r\n" +
		"From: " + from + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=UTF-8\r\n\r\n" +
		item.BodyHTML)
	if _, err := writer.Write(msg); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func smtpHostPort(cfg smtpRuntimeConfig) (string, string) {
	host := strings.TrimSpace(cfg.Host)
	port := firstNonEmpty(strings.TrimSpace(cfg.Port), "587")
	if splitHost, splitPort, err := net.SplitHostPort(host); err == nil {
		host = splitHost
		port = splitPort
	}
	return host, port
}

func (w *Worker) smtpConfig(ctx context.Context) smtpRuntimeConfig {
	cfg := smtpRuntimeConfig{
		Enabled:  strings.TrimSpace(w.cfg.SMTPHost) != "" && strings.TrimSpace(w.cfg.SMTPUser) != "",
		Host:     strings.TrimSpace(w.cfg.SMTPHost),
		Port:     firstNonEmpty(strings.TrimSpace(w.cfg.SMTPPort), "587"),
		User:     strings.TrimSpace(w.cfg.SMTPUser),
		Password: strings.TrimSpace(w.cfg.SMTPPassword),
		From:     strings.TrimSpace(w.cfg.SMTPFrom),
	}
	var settings models.SiteSettings
	if err := w.store.C("site_settings").FindOne(ctx, bson.M{}).Decode(&settings); err != nil {
		return cfg
	}
	hasSavedSMTP := settings.SMTPEnabled ||
		strings.TrimSpace(settings.SMTPHost) != "" ||
		strings.TrimSpace(settings.SMTPUser) != "" ||
		strings.TrimSpace(settings.SMTPPassword) != "" ||
		strings.TrimSpace(settings.SMTPFrom) != ""
	if !hasSavedSMTP {
		return cfg
	}
	return smtpRuntimeConfig{
		Enabled:  settings.SMTPEnabled,
		Host:     firstNonEmpty(strings.TrimSpace(settings.SMTPHost), cfg.Host),
		Port:     firstNonEmpty(strings.TrimSpace(settings.SMTPPort), cfg.Port, "587"),
		User:     firstNonEmpty(strings.TrimSpace(settings.SMTPUser), cfg.User),
		Password: firstNonEmpty(strings.TrimSpace(settings.SMTPPassword), cfg.Password),
		From:     firstNonEmpty(strings.TrimSpace(settings.SMTPFrom), cfg.From),
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
