package realtime

import "sync"

type Client struct {
	ChatID string
	Send   chan []byte
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]bool
}

func NewHub() *Hub {
	return &Hub{clients: map[string]map[*Client]bool{}}
}

func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[client.ChatID] == nil {
		h.clients[client.ChatID] = map[*Client]bool{}
	}
	h.clients[client.ChatID][client] = true
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if group := h.clients[client.ChatID]; group != nil {
		delete(group, client)
		close(client.Send)
		if len(group) == 0 {
			delete(h.clients, client.ChatID)
		}
	}
}

func (h *Hub) Broadcast(chatID string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients[chatID] {
		select {
		case client.Send <- payload:
		default:
		}
	}
}
