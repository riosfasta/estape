package handlers

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"bugmark/internal/models"
)

func TestTaskReportPDFIncludesFullChecklist(t *testing.T) {
	items := make([]models.ChecklistItem, 65)
	for i := range items {
		items[i] = models.ChecklistItem{
			Text: "Checklist item " + strconv.Itoa(i+1),
			Done: i%2 == 0,
		}
	}

	pdf := newSimplePDF("Project Task Report", "Checklist regression")
	pdf.taskRow(models.ClientTask{
		Type:      "description",
		Title:     "Task with long checklist",
		Content:   "Task content",
		Status:    "todo",
		Checklist: items,
		CreatedAt: time.Date(2026, 8, 6, 0, 0, 0, 0, time.UTC),
	}, nil, 0, taskReportOptions{Content: true, Checklist: true})

	output := string(pdf.bytes())
	if strings.Contains(output, "more checklist items") {
		t.Fatal("PDF checklist should not be truncated with a more-items marker")
	}
	if !strings.Contains(output, "Checklist item 65") {
		t.Fatal("PDF checklist should include the final checklist item")
	}
}

func TestTaskReportPDFIncludesReportNote(t *testing.T) {
	pdf := renderTaskReportPDF(taskReportData{
		Query:       taskReportQuery{Note: "Please review the completed checklist before billing."},
		GeneratedAt: time.Date(2026, 8, 7, 0, 0, 0, 0, time.UTC),
	})

	output := string(pdf)
	if !strings.Contains(output, "Report Note") {
		t.Fatal("PDF should include a report note heading")
	}
	if !strings.Contains(output, "Please review the completed checklist before billing.") {
		t.Fatal("PDF should include the report note text")
	}
}
