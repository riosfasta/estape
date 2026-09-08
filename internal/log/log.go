package log

import (
	"fmt"
	"log"
	"os"
)

// Logger wraps the standard library logger
type Logger struct {
	stdLogger *log.Logger
}

// New initializes and returns a new Logger instance
func New() *Logger {
	return &Logger{
		stdLogger: log.New(os.Stdout, "", log.LstdFlags),
	}
}

// Info prints a simple informational log message
func (l *Logger) Info(msg string) {
	l.stdLogger.Printf("INFO: %s", msg)
}

// Infow prints a message followed by key-value pairs (e.g., Infow("msg", "key", value))
func (l *Logger) Infow(msg string, keysAndValues ...interface{}) {
	kvString := ""
	for i := 0; i < len(keysAndValues); i += 2 {
		if i+1 < len(keysAndValues) {
			kvString += fmt.Sprintf(" %v=%v", keysAndValues[i], keysAndValues[i+1])
		} else {
			// Handle cases where an odd number of arguments is provided
			kvString += fmt.Sprintf(" %v=(MISSING)", keysAndValues[i])
		}
	}
	l.stdLogger.Printf("INFO: %s%s", msg, kvString)
}
