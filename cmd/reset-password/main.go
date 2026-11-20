package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"strings"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/config"
	"bugmark/internal/models"
	"bugmark/internal/store"

	"go.mongodb.org/mongo-driver/bson"
)

func main() {
	listFlag := flag.Bool("list", false, "List all users in the database")
	emailFlag := flag.String("email", "", "User email to reset password for")
	usernameFlag := flag.String("username", "", "User username to reset password for")
	passwordFlag := flag.String("password", "", "New password (at least 8 characters)")
	flag.Parse()

	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := store.Connect(ctx, cfg)
	if err != nil {
		log.Fatalf("connect mongodb: %v", err)
	}
	defer func() {
		_ = db.Client.Disconnect(ctx)
	}()

	if *listFlag {
		cursor, err := db.C("users").Find(ctx, bson.M{})
		if err != nil {
			log.Fatalf("find users: %v", err)
		}
		defer cursor.Close(ctx)

		var users []models.User
		if err := cursor.All(ctx, &users); err != nil {
			log.Fatalf("decode users: %v", err)
		}

		fmt.Printf("Found %d user(s):\n", len(users))
		for _, u := range users {
			fmt.Printf(" - ID: %s | Email: %s | Username: %s | Name: %s | Role: %s | Status: %s | 2FA: %v\n",
				u.ID.Hex(), u.Email, u.Username, u.Name, u.Role, u.Status, u.TwoFactorEnabled)
		}
		return
	}

	targetEmail := strings.ToLower(strings.TrimSpace(*emailFlag))
	targetUsername := strings.TrimSpace(*usernameFlag)
	newPassword := *passwordFlag

	if targetEmail == "" && targetUsername == "" {
		fmt.Println("Usage:")
		fmt.Println("  go run ./cmd/reset-password -list")
		fmt.Println("  go run ./cmd/reset-password -email user@example.com -password YourNewPassword123!")
		fmt.Println("  go run ./cmd/reset-password -username owner -password YourNewPassword123!")
		return
	}

	if len(newPassword) < 8 {
		log.Fatalf("password must be at least 8 characters long")
	}

	filter := bson.M{}
	if targetEmail != "" {
		filter["email"] = targetEmail
	} else {
		filter["username"] = targetUsername
	}

	var user models.User
	err = db.C("users").FindOne(ctx, filter).Decode(&user)
	if err != nil {
		log.Fatalf("user not found with filter %v: %v", filter, err)
	}

	hash, err := auth.HashPassword(newPassword)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}

	update := bson.M{
		"$set": bson.M{
			"password_hash": hash,
			"status":        models.StatusActive,
		},
	}

	_, err = db.C("users").UpdateByID(ctx, user.ID, update)
	if err != nil {
		log.Fatalf("update password: %v", err)
	}

	fmt.Printf("Successfully updated password for %s (%s)!\n", user.Name, user.Email)
}
