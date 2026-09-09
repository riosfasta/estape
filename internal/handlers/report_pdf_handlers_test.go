package handlers

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"bugmark/internal/models"

	"go.mongodb.org/mongo-driver/bson/primitive"
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

func TestTaskReportPDFReportNotePreservesLineBreaks(t *testing.T) {
	pdf := renderTaskReportPDF(taskReportData{
		Query:       taskReportQuery{Note: "First note line\nSecond note line"},
		GeneratedAt: time.Date(2026, 8, 7, 0, 0, 0, 0, time.UTC),
	})

	output := string(pdf)
	if strings.Contains(output, "First note line Second note line") {
		t.Fatal("PDF note should not collapse entered line breaks into one sentence")
	}
	if !strings.Contains(output, "(First note line)") || !strings.Contains(output, "(Second note line)") {
		t.Fatal("PDF should render each report note line")
	}
}

func TestRenderSingleTaskPDF(t *testing.T) {
	taskID := primitive.NewObjectID()
	clientID := primitive.NewObjectID()
	websiteID := primitive.NewObjectID()
	authorID := primitive.NewObjectID()

	task := models.ClientTask{
		ID:        taskID,
		ClientID:  clientID,
		WebsiteID: websiteID,
		Type:      "task",
		Title:     "Deploy Authentication Fix",
		Content:   "Fix token expiration issue when user is inactive for minutes.",
		Status:    "in_progress",
		CreatedAt: time.Date(2026, 9, 10, 10, 0, 0, 0, time.UTC),
		Checklist: []models.ChecklistItem{
			{Text: "Write regression test", Done: true},
			{Text: "Deploy to staging", Done: false},
		},
	}

	user := models.User{
		ID:    authorID,
		Name:  "Rio Developer",
		Email: "rio@example.com",
	}

	comment := models.ClientTaskComment{
		ID:        primitive.NewObjectID(),
		TaskID:    taskID,
		AuthorID:  authorID,
		Content:   "Staging deployment is pending approval.",
		CreatedAt: time.Date(2026, 9, 10, 11, 30, 0, 0, time.UTC),
	}

	pdfBytes := renderTaskReportPDF(taskReportData{
		Query: taskReportQuery{
			Scope:  "task",
			TaskID: taskID,
			Period: "all",
		},
		Tasks:        []models.ClientTask{task},
		TaskComments: []models.ClientTaskComment{comment},
		Clients: []models.ClientProject{
			{ID: clientID, Name: "Acme Corp"},
		},
		Websites: []models.ClientWebsite{
			{ID: websiteID, ClientID: clientID, Name: "acme.com", URL: "https://acme.com"},
		},
		UsersByID: map[primitive.ObjectID]models.User{
			authorID: user,
		},
		GeneratedAt: time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC),
	})

	output := string(pdfBytes)
	if !strings.Contains(output, "Task Export") {
		t.Fatal("Single task PDF should contain 'Task Export' header")
	}
	if !strings.Contains(output, "Deploy Authentication Fix") {
		t.Fatal("Single task PDF should contain the task title")
	}
	if !strings.Contains(output, "In Progress") {
		t.Fatal("Single task PDF should contain the formatted status")
	}
	if !strings.Contains(output, "Acme Corp") {
		t.Fatal("Single task PDF should contain the client project name")
	}
	if !strings.Contains(output, "[x] Write regression test") {
		t.Fatal("Single task PDF should render completed checklist item")
	}
	if !strings.Contains(output, "[ ] Deploy to staging") {
		t.Fatal("Single task PDF should render pending checklist item")
	}
	if !strings.Contains(output, "Rio Developer") {
		t.Fatal("Single task PDF should render the comment author")
	}
	if !strings.Contains(output, "Staging deployment is pending approval.") {
		t.Fatal("Single task PDF should render comment content")
	}
}

func TestRenderTaskReportPDF_StatusGroup(t *testing.T) {
	clientID := primitive.NewObjectID()
	websiteID := primitive.NewObjectID()

	task := models.ClientTask{
		ID:        primitive.NewObjectID(),
		ClientID:  clientID,
		WebsiteID: websiteID,
		Type:      "task",
		Title:     "Implement Export Feature",
		Status:    "in_progress",
		CreatedAt: time.Date(2026, 9, 10, 10, 0, 0, 0, time.UTC),
	}

	pdfBytes := renderTaskReportPDF(taskReportData{
		Query: taskReportQuery{
			Scope:     "domain",
			WebsiteID: websiteID,
			Status:    "in_progress",
			Period:    "all",
			Options:   taskReportOptions{Tasks: true},
		},
		Tasks: []models.ClientTask{task},
		Clients: []models.ClientProject{
			{ID: clientID, Name: "Alpha Inc"},
		},
		Websites: []models.ClientWebsite{
			{ID: websiteID, ClientID: clientID, Name: "alpha.io"},
		},
		UsersByID:   map[primitive.ObjectID]models.User{},
		GeneratedAt: time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC),
	})

	output := string(pdfBytes)
	if !strings.Contains(output, "Tasks: In Progress") {
		t.Fatal("Status group PDF should contain 'Tasks: In Progress' title")
	}
	if !strings.Contains(output, "Implement Export Feature") {
		t.Fatal("Status group PDF should include matching tasks")
	}
}
