package handlers

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"net/http/httptest"
	"testing"

	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
)

func TestMarketplaceImageValidation(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 150, 120))
	var jpg, pngData bytes.Buffer
	if err := jpeg.Encode(&jpg, img, nil); err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(&pngData, img); err != nil {
		t.Fatal(err)
	}
	for _, data := range [][]byte{jpg.Bytes(), pngData.Bytes()} {
		if _, err := validateMarketplaceImage(data); err != nil {
			t.Fatal(err)
		}
	}
	var tiny bytes.Buffer
	_ = png.Encode(&tiny, image.NewRGBA(image.Rect(0, 0, 1, 1)))
	for name, data := range map[string][]byte{"too big": make([]byte, marketplaceImageLimit+1), "tiny": tiny.Bytes(), "fake": []byte("<svg onload='alert(1)'></svg>"), "truncated": jpg.Bytes()[:jpg.Len()/2]} {
		t.Run(name, func(t *testing.T) {
			if _, err := validateMarketplaceImage(data); err == nil {
				t.Fatal("invalid upload accepted")
			}
		})
	}
}

func TestYouTubePortfolioLinks(t *testing.T) {
	for _, input := range []string{"https://youtu.be/dQw4w9WgXcQ?t=3", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/shorts/dQw4w9WgXcQ"} {
		url, err := normalizeYouTubeURL(input)
		if err != nil || url != "https://www.youtube.com/watch?v=dQw4w9WgXcQ" {
			t.Fatalf("%s: %s %v", input, url, err)
		}
	}
	for _, input := range []string{"javascript:alert(1)", "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ", "https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ", "https://youtube.com/channel/abc", "https://youtube.com/watch?v=bad", "http://youtu.be/dQw4w9WgXcQ"} {
		if _, err := normalizeYouTubeURL(input); err == nil {
			t.Fatalf("unsafe/non-video URL accepted: %s", input)
		}
	}
}

func TestFreelancerEffectiveAvailability(t *testing.T) {
	for _, state := range []string{"", "available", "busy", "running_project"} {
		profile := models.FreelancerProfile{Availability: state}
		expected := state
		if expected == "" {
			expected = "available"
		}
		if freelancerAvailability(profile) != expected {
			t.Fatal("manual status lost")
		}
		profile.ActiveJobs = 1
		if freelancerAvailability(profile) != "running_project" || publicFreelancer(profile)["available"] != false {
			t.Fatal("active freelancer advertised as available")
		}
	}
}

func TestFreelancerFilterRejectsInvalidValues(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/freelancers", (&Server{}).marketplaceFreelancers)
	for _, query := range []string{"finished_jobs=-1", "finished_jobs=abc", "finished_jobs=1000001", "availability=invalid", "rating=NaN"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/freelancers?"+query, nil))
		if response.Code != 400 {
			t.Fatalf("%s: %d", query, response.Code)
		}
	}
}
