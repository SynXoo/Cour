package httpapi

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// requestLogger emits one structured line per request, levelled by outcome.
func requestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			next.ServeHTTP(ww, r)

			attrs := []any{
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", middleware.GetReqID(r.Context()),
				"ip", r.RemoteAddr,
			}
			switch {
			case ww.Status() >= 500:
				log.Error("request", attrs...)
			case ww.Status() >= 400:
				log.Warn("request", attrs...)
			default:
				log.Info("request", attrs...)
			}
		})
	}
}

// recoverer converts panics into 500 envelopes instead of dropped connections.
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					if rec == http.ErrAbortHandler { //nolint:errorlint // sentinel comparison per net/http docs
						panic(rec)
					}
					log.Error("panic recovered",
						"panic", rec,
						"stack", string(debug.Stack()),
						"request_id", middleware.GetReqID(r.Context()),
					)
					writeError(w, http.StatusInternalServerError, CodeInternal, "something went wrong")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
