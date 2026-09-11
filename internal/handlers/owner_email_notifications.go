package handlers

import (
	"context"
	"fmt"
	"html"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type ownerEmailNotificationKind string

const (
	ownerEmailNewRegistration ownerEmailNotificationKind = "owner_new_registration"
	ownerEmailPurchaseSuccess ownerEmailNotificationKind = "owner_purchase_success"
	ownerEmailNewChat         ownerEmailNotificationKind = "owner_new_chat"
	ownerEmailManualTransfer  ownerEmailNotificationKind = "owner_manual_transfer"
)

func (s *Server) ownerEmailNotificationConfig(ctx context.Context, kind ownerEmailNotificationKind) (models.SiteSettings, string, bool) {
	if s.mailer == nil || !s.mailer.CanSend(ctx) {
		return models.SiteSettings{}, "", false
	}
	settings, err := s.loadSiteSettings(ctx)
	if err != nil {
		settings = s.defaultSiteSettings(time.Now())
	}
	settings = s.settingsWithConfigFallback(settings)
	enabled := false
	switch kind {
	case ownerEmailNewRegistration:
		enabled = settings.OwnerNotifyRegistration
	case ownerEmailPurchaseSuccess:
		enabled = settings.OwnerNotifyPurchase
	case ownerEmailNewChat:
		enabled = settings.OwnerNotifyNewChat
	}
	if !enabled {
		return settings, "", false
	}
	recipient := strings.ToLower(strings.TrimSpace(settings.OwnerNotificationEmail))
	if recipient == "" {
		recipient = strings.ToLower(strings.TrimSpace(s.cfg.OwnerEmail))
	}
	if recipient == "" || !strings.Contains(recipient, "@") {
		return settings, "", false
	}
	return settings, recipient, true
}

func (s *Server) enqueueOwnerBehaviorEmail(ctx context.Context, kind ownerEmailNotificationKind, subject string, intro string, rows [][2]string, actionLabel string, actionPath string) {
	settings, recipient, ok := s.ownerEmailNotificationConfig(ctx, kind)
	if !ok {
		return
	}
	var table strings.Builder
	for _, row := range rows {
		table.WriteString(ownerEmailRow(row[0], row[1]))
	}
	body := `<p>` + html.EscapeString(strings.TrimSpace(intro)) + `</p>` +
		`<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;border:1px solid #d7e4df;border-radius:8px;overflow:hidden;">` +
		table.String() +
		`</table>`
	if strings.TrimSpace(actionLabel) != "" && strings.TrimSpace(actionPath) != "" {
		body += `<p><a href="` + html.EscapeString(s.appAbsoluteURL(actionPath)) + `">` + html.EscapeString(actionLabel) + `</a></p>`
	}
	appName := firstNonEmpty(settings.SiteName, s.cfg.AppName, "bugmega")
	_ = s.mailer.Enqueue(ctx, models.EmailQueueItem{
		Recipient: recipient,
		Type:      string(kind),
		Subject:   appName + " " + strings.TrimSpace(subject),
		BodyHTML:  body,
	})
}

func ownerEmailRow(label string, value string) string {
	if strings.TrimSpace(value) == "" {
		value = "-"
	}
	return `<tr><th style="text-align:left;padding:8px 12px;border-bottom:1px solid #d7e4df;color:#45645e;">` +
		html.EscapeString(label) +
		`</th><td style="padding:8px 12px;border-bottom:1px solid #d7e4df;color:#10211d;">` +
		html.EscapeString(value) +
		`</td></tr>`
}

func ownerEmailTime(value time.Time) string {
	if value.IsZero() {
		value = time.Now()
	}
	return value.Format("Jan 2, 2006 3:04 PM MST")
}

func (s *Server) enqueueOwnerRegistrationEmail(ctx context.Context, user models.User, team models.Team, provider string, invitation *models.TeamInvitation) {
	if team.ID.IsZero() && !user.TeamID.IsZero() {
		_ = s.store.C("teams").FindOne(ctx, bson.M{"_id": user.TeamID}).Decode(&team)
	}
	source := "New workspace"
	if invitation != nil {
		source = "Accepted team invitation"
	}
	name := firstNonEmpty(user.Name, user.Username, user.Email, "New user")
	rows := [][2]string{
		{"Name", name},
		{"Username", user.Username},
		{"Email", user.Email},
		{"Account role", string(user.Role)},
		{"Staff role", staffRoleDisplayName(user.StaffRole)},
		{"Company/team", team.Name},
		{"Company email", team.CompanyEmail},
		{"Registration source", source},
		{"Sign-in method", firstNonEmpty(provider, "Email/password")},
		{"Registered at", ownerEmailTime(user.CreatedAt)},
		{"User ID", user.ID.Hex()},
	}
	s.enqueueOwnerBehaviorEmail(ctx, ownerEmailNewRegistration, "new registration: "+name, name+" registered an account.", rows, "Open platform manage users", "/admin/users")
}

func (s *Server) enqueueOwnerNewChatEmail(ctx context.Context, chat models.Chat, creatorID primitive.ObjectID) {
	creator, err := s.loadUser(ctx, creatorID)
	if err == nil && creator.Role == models.RoleOwnerAdmin {
		return
	}
	var team models.Team
	if !chat.TeamID.IsZero() {
		_ = s.store.C("teams").FindOne(ctx, bson.M{"_id": chat.TeamID}).Decode(&team)
	}
	actor := "Someone"
	creatorEmail := ""
	creatorUsername := ""
	if err == nil {
		s.ensureUserIdentity(ctx, &creator)
		actor = firstNonEmpty(creator.Name, creator.Username, creator.Email, actor)
		creatorEmail = creator.Email
		creatorUsername = creator.Username
	}
	title := chatDisplayTitle(chat)
	rows := [][2]string{
		{"Chat title", title},
		{"Chat type", firstNonEmpty(chat.Type, "chat")},
		{"Started by", actor},
		{"Username", creatorUsername},
		{"User email", creatorEmail},
		{"Company/team", team.Name},
		{"Participant count", strconv.Itoa(len(chat.ParticipantIDs))},
		{"Started at", ownerEmailTime(chat.CreatedAt)},
		{"Chat ID", chat.ID.Hex()},
	}
	subject, introduction := "new chat: "+title, actor+" started a new chat session."
	if chat.Type == "support" {
		subject, introduction = "new support message: "+title, actor+" sent a new message to Bugmega support."
	}
	s.enqueueOwnerBehaviorEmail(ctx, ownerEmailNewChat, subject, introduction, rows, "Open chat", "/chat?id="+chat.ID.Hex())
}

func (s *Server) enqueueOwnerManualTransferEmail(ctx context.Context, transfer models.MarketplaceTransfer, requesterID primitive.ObjectID) {
	if s.mailer == nil {
		return
	}
	requester, err := s.loadUser(ctx, requesterID)
	requesterName := "User"
	requesterEmail := ""
	requesterUsername := ""
	if err == nil {
		s.ensureUserIdentity(ctx, &requester)
		requesterName = firstNonEmpty(requester.Name, requester.Username, requester.Email, "User")
		requesterEmail = requester.Email
		requesterUsername = requester.Username
	}

	settings, _ := s.loadSiteSettings(ctx)
	settings = s.settingsWithConfigFallback(settings)
	appName := firstNonEmpty(settings.SiteName, s.cfg.AppName, "bugmega")

	// Collect owner recipients: configured owner email + active owner_adm accounts
	recipientSet := make(map[string]bool)
	if email := strings.ToLower(strings.TrimSpace(settings.OwnerNotificationEmail)); email != "" && strings.Contains(email, "@") {
		recipientSet[email] = true
	}
	if email := strings.ToLower(strings.TrimSpace(s.cfg.OwnerEmail)); email != "" && strings.Contains(email, "@") {
		recipientSet[email] = true
	}

	var ownerAdmins []models.User
	if s.store != nil {
		cur, err := s.store.C("users").Find(ctx, bson.M{"role": models.RoleOwnerAdmin, "status": models.StatusActive})
		if err == nil {
			defer cur.Close(ctx)
			_ = cur.All(ctx, &ownerAdmins)
		}
	}
	for _, admin := range ownerAdmins {
		if email := strings.ToLower(strings.TrimSpace(admin.Email)); email != "" && strings.Contains(email, "@") {
			recipientSet[email] = true
		}
	}

	// Prepare email content
	kindTitle := strings.Title(transfer.Kind)
	amountStr := fmt.Sprintf("$%.2f", float64(transfer.Amount)/100.0)
	subject := fmt.Sprintf("[%s] Action Required: New manual %s request (%s) from %s", appName, transfer.Kind, amountStr, requesterName)
	intro := fmt.Sprintf("A new manual %s request of %s has been submitted by %s and is awaiting your review and settlement.", transfer.Kind, amountStr, requesterName)

	rows := [][2]string{
		{"Request type", kindTitle},
		{"Amount requested", amountStr},
		{"Requester name", requesterName},
		{"Requester email", requesterEmail},
		{"Requester username", requesterUsername},
		{"User ID", transfer.UserID.Hex()},
		{"Payout destination", transfer.Destination},
		{"PayPal payment note / reference", transfer.PaymentReference},
		{"Requested at", ownerEmailTime(transfer.CreatedAt)},
		{"Processing instructions", "Send the payout manually using your external payment provider. Then record the completed payment reference and actual transaction fee in the Settlements & Refunds dashboard."},
	}

	var table strings.Builder
	for _, row := range rows {
		table.WriteString(ownerEmailRow(row[0], row[1]))
	}
	actionURL := s.appAbsoluteURL("/admin/settlements")
	body := `<p style="font-size:15px;color:#10211d;">` + html.EscapeString(intro) + `</p>` +
		`<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;border:1px solid #d7e4df;border-radius:8px;overflow:hidden;margin:16px 0;">` +
		table.String() +
		`</table>` +
		`<p style="margin-top:20px;"><a href="` + html.EscapeString(actionURL) + `" style="display:inline-block;padding:10px 18px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Open Settlements &amp; Refunds</a></p>`

	for recipient := range recipientSet {
		_ = s.mailer.Enqueue(ctx, models.EmailQueueItem{
			Recipient: recipient,
			Type:      string(ownerEmailManualTransfer),
			Subject:   subject,
			BodyHTML:  body,
		})
	}

	// In-platform notifications to all active owner admins
	if len(ownerAdmins) > 0 {
		ownerIDs := make([]primitive.ObjectID, len(ownerAdmins))
		for i, o := range ownerAdmins {
			ownerIDs[i] = o.ID
		}
		notifyMsg := fmt.Sprintf("New manual %s request: %s from %s awaiting settlement.", transfer.Kind, amountStr, requesterName)
		s.notifyUserIDs(ctx, ownerIDs, requesterID, "manual_transfer_request", notifyMsg, transfer.ID)
	}
}

