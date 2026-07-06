package integrations

import (
	"context"
	"fmt"
)

type ExternalProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url,omitempty"`
}

type ExternalTask struct {
	ID          string   `json:"id"`
	URL         string   `json:"url,omitempty"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Status      string   `json:"status"`
	Priority    string   `json:"priority"`
	Tags        []string `json:"tags"`
}

type TaskIntegrationProvider interface {
	Name() string
	ListProjects(context.Context) ([]ExternalProject, error)
	FetchTasks(context.Context, string) ([]ExternalTask, error)
	CreateTask(context.Context, string, ExternalTask) (ExternalTask, error)
	RefreshAuth(context.Context) error
}

type MockProvider struct {
	provider string
}

func NewProvider(provider string) TaskIntegrationProvider {
	return MockProvider{provider: provider}
}

func (p MockProvider) Name() string {
	return p.provider
}

func (p MockProvider) ListProjects(_ context.Context) ([]ExternalProject, error) {
	return []ExternalProject{
		{ID: p.provider + "-alpha", Name: fmt.Sprintf("%s Website QA", title(p.provider)), URL: "https://example.com"},
		{ID: p.provider + "-ops", Name: fmt.Sprintf("%s Operations Board", title(p.provider))},
	}, nil
}

func (p MockProvider) FetchTasks(_ context.Context, projectID string) ([]ExternalTask, error) {
	return []ExternalTask{
		{ID: projectID + "-1", URL: "https://example.com/task/1", Title: "Imported homepage hero feedback", Description: "Imported from " + p.provider, Status: "To Do", Priority: "High", Tags: []string{"imported", p.provider}},
		{ID: projectID + "-2", URL: "https://example.com/task/2", Title: "Review mobile navigation spacing", Description: "Imported from " + p.provider, Status: "In Progress", Priority: "Normal", Tags: []string{"imported", p.provider}},
	}, nil
}

func (p MockProvider) CreateTask(_ context.Context, projectID string, task ExternalTask) (ExternalTask, error) {
	task.ID = fmt.Sprintf("%s-%s-exported", projectID, p.provider)
	task.URL = fmt.Sprintf("https://example.com/%s/tasks/%s", p.provider, task.ID)
	return task, nil
}

func (p MockProvider) RefreshAuth(_ context.Context) error {
	return nil
}

func title(value string) string {
	if value == "" {
		return value
	}
	return string(value[0]-32) + value[1:]
}
