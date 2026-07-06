package app

import (
	"context"

	"bugmark/internal/auth"
	"bugmark/internal/billing"
	"bugmark/internal/config"
	"bugmark/internal/email"
	"bugmark/internal/handlers"
	"bugmark/internal/integrations"
	"bugmark/internal/realtime"
	"bugmark/internal/store"

	"github.com/gin-gonic/gin"
)

type App struct {
	cfg   config.Config
	store *store.Store
}

func New(cfg config.Config, store *store.Store) *App {
	return &App{cfg: cfg, store: store}
}

func (a *App) Router() *gin.Engine {
	tokens := auth.NewTokenManager(a.cfg.JWTSecret)
	hub := realtime.NewHub()
	mailer := email.NewWorker(a.cfg, a.store)

	go mailer.Start(context.Background())

	payments := map[string]billing.PaymentProvider{
		"stripe": billing.NewStripeProvider(a.cfg.AppURL),
		"paypal": billing.NewPayPalProvider(a.cfg.AppURL),
	}
	taskIntegrations := map[string]integrations.TaskIntegrationProvider{
		"bugherd": integrations.NewProvider("bugherd"),
		"asana":   integrations.NewProvider("asana"),
		"clickup": integrations.NewProvider("clickup"),
		"monday":  integrations.NewProvider("monday"),
	}

	api := handlers.New(a.cfg, a.store, tokens, mailer, hub, payments, taskIntegrations)
	return api.Router()
}
