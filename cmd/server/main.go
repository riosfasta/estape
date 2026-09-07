package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"bugmark/internal/app"
	"bugmark/internal/config"
	"bugmark/internal/log"
	"bugmark/internal/store"
)

func main() {
	cfg := config.Load()
	logger := log.New(cfg.LogLevel, false)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	db, err := store.Connect(ctx, cfg)
	if err != nil {
		logger.Fatalw("connect mongodb", "err", err)
	}
	defer func() {
		disconnectCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = db.Client.Disconnect(disconnectCtx)
	}()

	if err := db.CreateIndexes(ctx); err != nil {
		logger.Fatalw("create indexes", "err", err)
	}
	if err := db.Seed(ctx, cfg); err != nil {
		logger.Fatalw("seed database", "err", err)
	}

	application := app.New(cfg, logger, db)
	router := application.Router()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Infow("bugmega running", "url", cfg.AppURL)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatalw("server error", "err", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	shutdownCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Warnw("shutdown error", "err", err)
	}
}
