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
	"bugmark/internal/store"
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	db, err := store.Connect(ctx, cfg)
	if err != nil {
		log.Fatalf("connect mongodb: %v", err)
	}
	defer func() {
		disconnectCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = db.Client.Disconnect(disconnectCtx)
	}()

	if err := db.CreateIndexes(ctx); err != nil {
		log.Fatalf("create indexes: %v", err)
	}
	if err := db.Seed(ctx, cfg); err != nil {
		log.Fatalf("seed database: %v", err)
	}

	application := app.New(cfg, db)
	router := application.Router()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("bugmega running at %s", cfg.AppURL)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	shutdownCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
}
