package handlers

import (
	"bytes"
	"errors"
	"image"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
	_ "golang.org/x/image/webp"
)

const marketplaceImageLimit = 500 * 1024

func validateMarketplaceImage(data []byte) (string, error) {
	if len(data) == 0 || len(data) > marketplaceImageLimit {
		return "", errors.New("Each image must be 500 KB or smaller")
	}
	config, kind, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (kind != "jpeg" && kind != "png" && kind != "webp") || config.Width < 100 || config.Height < 100 || config.Width > 10000 || config.Height > 10000 || int64(config.Width)*int64(config.Height) > 16000000 {
		return "", errors.New("Use a valid JPG, JPEG, PNG or WebP image, at least 100 x 100 pixels")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return "", errors.New("Image is incomplete or corrupt")
	}
	return kind, nil
}

func (s *Server) marketplaceUploadMedia(c *gin.Context) {
	user, _ := currentUser(c)
	file, err := c.FormFile("file")
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	if err != nil {
		marketplaceError(c, marketInvalid("Choose an image up to 500 KB"))
		return
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp" {
		marketplaceError(c, marketInvalid("Use JPG, JPEG, PNG or WebP"))
		return
	}
	stream, err := file.Open()
	if marketplaceError(c, err) {
		return
	}
	defer stream.Close()
	data, err := io.ReadAll(io.LimitReader(stream, marketplaceImageLimit+1))
	if marketplaceError(c, err) {
		return
	}
	kind, err := validateMarketplaceImage(data)
	if err != nil {
		marketplaceError(c, marketInvalid(err.Error()))
		return
	}
	if kind == "jpeg" {
		kind = "jpg"
	}
	name := primitive.NewObjectID().Hex() + "." + kind
	dir := filepath.Join(s.cfg.UploadDir, userUploadDir(user.ID))
	if marketplaceError(c, os.MkdirAll(dir, 0755)) {
		return
	}
	if marketplaceError(c, os.WriteFile(filepath.Join(dir, name), data, 0644)) {
		return
	}
	c.JSON(http.StatusCreated, gin.H{"url": userUploadURLPrefix(user.ID) + name})
}

func (s *Server) validateMarketplaceMediaURL(userID primitive.ObjectID, value string) error {
	prefix := userUploadURLPrefix(userID)
	if !strings.HasPrefix(value, prefix) {
		return errors.New("Upload your own project images")
	}
	name := strings.TrimPrefix(value, prefix)
	if name == "" || strings.ContainsAny(name, "/\\?#%") || strings.Contains(name, "..") {
		return errors.New("Invalid image URL")
	}
	file, err := os.Open(filepath.Join(s.cfg.UploadDir, userUploadDir(userID), name))
	if err != nil {
		return errors.New("Image not found; please upload it again")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, marketplaceImageLimit+1))
	if err != nil {
		return errors.New("Cannot read image")
	}
	_, err = validateMarketplaceImage(data)
	return err
}

var youtubeVideoID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

func normalizeYouTubeURL(value string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return "", errors.New("Use an HTTPS YouTube video URL")
	}
	id := ""
	switch strings.ToLower(u.Hostname()) {
	case "youtu.be":
		id = strings.TrimPrefix(u.Path, "/")
	case "youtube.com", "www.youtube.com", "m.youtube.com":
		if u.Path == "/watch" {
			id = u.Query().Get("v")
		} else {
			for _, prefix := range []string{"/shorts/", "/embed/", "/live/"} {
				if strings.HasPrefix(u.Path, prefix) {
					id = strings.TrimPrefix(u.Path, prefix)
					break
				}
			}
		}
	}
	if !youtubeVideoID.MatchString(id) {
		return "", errors.New("Enter a YouTube video link, not a channel or playlist")
	}
	return "https://www.youtube.com/watch?v=" + id, nil
}

func freelancerAvailability(p models.FreelancerProfile) string {
	if p.ActiveJobs > 0 {
		return "running_project"
	}
	if p.Availability == "busy" || p.Availability == "running_project" {
		return p.Availability
	}
	return "available"
}
