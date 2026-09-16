package handlers

import (
	"bytes"
	"html/template"
	"path/filepath"
	"strings"
	"testing"

	"bugmark/internal/models"
)

func TestCustomCodeTemplatePayloadRendersAtConfiguredLocations(t *testing.T) {
	settings := models.SiteSettings{
		CustomHeadHTML:      `<script data-custom-slot="head"></script>`,
		CustomBodyStartHTML: `<div data-custom-slot="body-start"></div>`,
		CustomBodyEndHTML:   `<script data-custom-slot="body-end"></script>`,
	}
	payload := customCodeTemplatePayload(settings)
	payload["AppName"] = "Test"
	payload["Title"] = "Test"
	payload["Year"] = 2026
	payload["HTML"] = template.HTML("<p>Page</p>")

	for _, name := range []string{"home.gohtml", "legal.gohtml", "app.gohtml", "marketplace_privacy.gohtml"} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join("..", "..", "web", "templates", name)
			tpl, err := template.ParseFiles(path)
			if err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			if err := tpl.ExecuteTemplate(&out, name, payload); err != nil {
				t.Fatal(err)
			}
			rendered := out.String()
			headCode := strings.Index(rendered, `data-custom-slot="head"`)
			headEnd := strings.Index(rendered, "</head>")
			bodyOpen := strings.Index(rendered, "<body")
			bodyStartCode := strings.Index(rendered, `data-custom-slot="body-start"`)
			bodyEndCode := strings.Index(rendered, `data-custom-slot="body-end"`)
			bodyEnd := strings.LastIndex(rendered, "</body>")
			if headCode < 0 || headCode > headEnd {
				t.Fatalf("head code was not rendered before </head>")
			}
			if bodyStartCode < bodyOpen || bodyStartCode > bodyEndCode {
				t.Fatalf("body-start code was not rendered after <body>")
			}
			if bodyEndCode < 0 || bodyEndCode > bodyEnd {
				t.Fatalf("body-end code was not rendered before </body>")
			}
			if strings.Contains(rendered, "&lt;script data-custom-slot") {
				t.Fatalf("trusted owner code was escaped")
			}
		})
	}
}
