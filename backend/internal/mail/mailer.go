// Package mail sends transactional email. The dev default writes messages to
// .emails/ instead of sending — the same contract, none of the SMTP setup.
package mail

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Message struct {
	To      string
	Subject string
	Body    string
}

type Mailer interface {
	Send(ctx context.Context, m Message) error
}

// New picks the implementation for the configured mode.
func New(mode string, log *slog.Logger) Mailer {
	switch mode {
	case "smtp":
		// Deliberate stub: wire a provider (SES, Postmark, SMTP relay) at
		// deploy time. Falling back to log keeps environments bootable.
		log.Warn("EMAIL_MODE=smtp is not configured in this build; falling back to log mailer")
		return LogMailer{Dir: ".emails", Log: log}
	default:
		return LogMailer{Dir: ".emails", Log: log}
	}
}

// LogMailer writes each message to a file and logs the path.
type LogMailer struct {
	Dir string
	Log *slog.Logger
}

func (m LogMailer) Send(_ context.Context, msg Message) error {
	if err := os.MkdirAll(m.Dir, 0o755); err != nil {
		return fmt.Errorf("mail: mkdir %s: %w", m.Dir, err)
	}
	name := fmt.Sprintf("%s-%s.txt", time.Now().Format("20060102-150405.000"), slugish(msg.Subject))
	path := filepath.Join(m.Dir, name)
	content := fmt.Sprintf("To: %s\nSubject: %s\nDate: %s\n\n%s\n", msg.To, msg.Subject, time.Now().Format(time.RFC1123Z), msg.Body)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return fmt.Errorf("mail: write %s: %w", path, err)
	}
	m.Log.Info("email written (log mailer)", "to", msg.To, "subject", msg.Subject, "file", path)
	return nil
}

func slugish(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case b.Len() > 0 && !strings.HasSuffix(b.String(), "-"):
			b.WriteByte('-')
		}
	}
	return strings.Trim(b.String(), "-")
}
