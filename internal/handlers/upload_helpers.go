package handlers

import (
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"mime/multipart"
	"os"
	"path/filepath"
)

func saveProfileUpload(file *multipart.FileHeader, path string, ext string, maxSize int) error {
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif":
	default:
		return errors.New("image must be a JPG, PNG, or GIF file")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return errors.New("could not prepare upload directory")
	}
	src, err := file.Open()
	if err != nil {
		return errors.New("could not open uploaded image")
	}
	img, _, err := image.Decode(src)
	_ = src.Close()
	if err != nil {
		return errors.New("image must be a valid JPG, PNG, or GIF file")
	}
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return errors.New("image has invalid dimensions")
	}
	if width <= maxSize && height <= maxSize {
		return copyUploadedFile(file, path)
	}
	scale := math.Min(float64(maxSize)/float64(width), float64(maxSize)/float64(height))
	targetWidth := max(1, int(math.Round(float64(width)*scale)))
	targetHeight := max(1, int(math.Round(float64(height)*scale)))
	resized := resizeNearest(img, targetWidth, targetHeight)
	return encodeProfileImage(path, ext, resized)
}

func copyUploadedFile(file *multipart.FileHeader, path string) error {
	src, err := file.Open()
	if err != nil {
		return errors.New("could not open uploaded image")
	}
	defer src.Close()
	dst, err := os.Create(path)
	if err != nil {
		return errors.New("could not save uploaded image")
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return errors.New("could not save uploaded image")
	}
	return nil
}

func resizeNearest(src image.Image, width int, height int) *image.RGBA {
	srcBounds := src.Bounds()
	srcWidth := srcBounds.Dx()
	srcHeight := srcBounds.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		sourceY := srcBounds.Min.Y + (y * srcHeight / height)
		for x := 0; x < width; x++ {
			sourceX := srcBounds.Min.X + (x * srcWidth / width)
			dst.Set(x, y, src.At(sourceX, sourceY))
		}
	}
	return dst
}

func encodeProfileImage(path string, ext string, img image.Image) error {
	dst, err := os.Create(path)
	if err != nil {
		return errors.New("could not save resized profile photo")
	}
	defer dst.Close()
	switch ext {
	case ".jpg", ".jpeg":
		if err := jpeg.Encode(dst, img, &jpeg.Options{Quality: 86}); err != nil {
			return errors.New("could not save resized profile photo")
		}
	case ".png":
		if err := png.Encode(dst, img); err != nil {
			return errors.New("could not save resized profile photo")
		}
	case ".gif":
		if err := gif.Encode(dst, img, nil); err != nil {
			return errors.New("could not save resized profile photo")
		}
	}
	return nil
}
