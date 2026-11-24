package email

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"html"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/models"
)

// SendWithTenantSMTP sends an email using the tenant's own SMTP server settings.
func (w *Worker) SendWithTenantSMTP(ctx context.Context, smtpCfg models.TenantSMTPSettings, toEmail, subject, bodyHTML string) error {
	if !smtpCfg.Enabled {
		return errors.New("tenant SMTP is disabled")
	}
	host := strings.TrimSpace(smtpCfg.Host)
	if host == "" {
		return errors.New("tenant SMTP host is empty")
	}
	user := strings.TrimSpace(smtpCfg.Username)
	port := strconv.Itoa(smtpCfg.Port)
	if port == "0" || port == "" {
		port = "587"
	}
	fromEmail := strings.TrimSpace(smtpCfg.FromEmail)
	if fromEmail == "" {
		fromEmail = user
	}
	fromName := strings.TrimSpace(smtpCfg.FromName)
	if fromName == "" {
		fromName = fromEmail
	}

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
		return fmt.Errorf("connect to tenant SMTP: %w", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(smtpSendTimeout))

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("new SMTP client: %w", err)
	}
	defer client.Close()

	if port != "465" {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
				return fmt.Errorf("starttls: %w", err)
			}
		}
	}

	if user != "" && smtpCfg.Password != "" {
		auth := smtp.PlainAuth("", user, smtpCfg.Password, host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}

	if err := client.Mail(fromEmail); err != nil {
		return fmt.Errorf("mail from: %w", err)
	}
	if err := client.Rcpt(strings.TrimSpace(toEmail)); err != nil {
		return fmt.Errorf("rcpt to: %w", err)
	}

	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("data writer: %w", err)
	}

	cleanSubject := strings.NewReplacer("\r", " ", "\n", " ").Replace(subject)
	sender := mail.Address{Name: fromName, Address: fromEmail}
	msg := []byte("To: " + toEmail + "\r\n" +
		"From: " + sender.String() + "\r\n" +
		"Subject: " + cleanSubject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=UTF-8\r\n\r\n" +
		bodyHTML)

	if _, err := writer.Write(msg); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

// SendTenantAutoResponder dispatches the welcome/auto-responder email to the visitor.
func (w *Worker) SendTenantAutoResponder(ctx context.Context, tenant *models.Tenant, visitorEmail, visitorName string, fields map[string]string) error {
	if visitorEmail == "" {
		return nil
	}

	subject := tenant.AutoResponder.Subject
	if strings.TrimSpace(subject) == "" {
		subject = "Thank you for contacting " + tenant.CompanyName
	}
	body := tenant.AutoResponder.Body
	if strings.TrimSpace(body) == "" {
		body = "<p>Hi {name},</p><p>Thank you for reaching out to {company_name}! We have received your message and will get back to you shortly.</p>"
	}

	displayName := visitorName
	if strings.TrimSpace(displayName) == "" {
		displayName = "there"
	}

	replacer := strings.NewReplacer(
		"{name}", html.EscapeString(displayName),
		"{company_name}", html.EscapeString(tenant.CompanyName),
		"{subdomain}", html.EscapeString(tenant.Subdomain),
		"{email}", html.EscapeString(visitorEmail),
	)
	subject = replacer.Replace(subject)
	bodyHTML := replacer.Replace(body)

	// Try tenant custom SMTP first if enabled
	if tenant.SMTP.Enabled && strings.TrimSpace(tenant.SMTP.Host) != "" {
		if err := w.SendWithTenantSMTP(ctx, tenant.SMTP, visitorEmail, subject, bodyHTML); err == nil {
			return nil
		}
	}

	// Fallback to platform SMTP queue
	return w.Enqueue(ctx, models.EmailQueueItem{
		Recipient: visitorEmail,
		Type:      "tenant_autoresponder",
		Subject:   subject,
		BodyHTML:  bodyHTML,
	})
}

// SendTenantOwnerNotification alerts the tenant owner when a visitor submits a form.
func (w *Worker) SendTenantOwnerNotification(ctx context.Context, tenant *models.Tenant, ownerEmail, formName string, fields map[string]string) error {
	if ownerEmail == "" {
		return nil
	}

	subject := fmt.Sprintf("[%s] New submission on %s", tenant.CompanyName, formName)
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("<h3>New form submission on %s (%s.bugmega.com)</h3>", html.EscapeString(tenant.CompanyName), tenant.Subdomain))
	sb.WriteString("<table border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;'>")
	for k, v := range fields {
		sb.WriteString(fmt.Sprintf("<tr><td><strong>%s</strong></td><td>%s</td></tr>", html.EscapeString(k), html.EscapeString(v)))
	}
	sb.WriteString("</table>")

	return w.Enqueue(ctx, models.EmailQueueItem{
		Recipient: ownerEmail,
		Type:      "tenant_form_lead",
		Subject:   subject,
		BodyHTML:  sb.String(),
	})
}
