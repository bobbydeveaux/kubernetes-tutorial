// whoami: a tiny web service that tells you which pod answered.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"
)

// Baked in at build time: docker build --build-arg VERSION=v2
var version = "v1"

type info struct {
	Pod     string `json:"pod"`
	Node    string `json:"node"`
	IP      string `json:"ip"`
	Version string `json:"version"`
	Served  int64  `json:"served"`
	Hue     int    `json:"-"`
}

var served atomic.Int64

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Same hash as the demo UI, so a pod has the same colour everywhere.
func hue(s string) int {
	h := 7
	for _, c := range s {
		h = (h*31 + int(c)) % 360
	}
	return 165 + h%130 // teal..purple, never the red/amber/green used for status
}

func whoami() info {
	host, _ := os.Hostname()
	pod := env("POD_NAME", host)
	return info{
		Pod:     pod,
		Node:    env("NODE_NAME", "unknown"),
		IP:      env("POD_IP", "unknown"),
		Version: version,
		Served:  served.Add(1),
		Hue:     hue(pod),
	}
}

var page = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Pod}}</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font-family: ui-sans-serif, system-ui, sans-serif; color:#fff;
         background: hsl({{.Hue}} 65% 32%); }
  main { text-align:center; padding:2rem; }
  small { text-transform:uppercase; letter-spacing:.2em; opacity:.75; }
  h1 { font: 700 clamp(2rem, 6vw, 5rem) ui-monospace, Menlo, monospace; margin:.3em 0; overflow-wrap:anywhere; }
  dl { display:inline-grid; grid-template-columns:auto auto; gap:.4rem 1.5rem; font-size:1.4rem; text-align:left; }
  dt { opacity:.7; } dd { margin:0; font-family: ui-monospace, Menlo, monospace; }
  .v { display:inline-block; padding:.2em .8em; border-radius:99px; background:#fff; color:#111; font-weight:700; }
</style></head>
<body><main>
  <small>Hello from pod</small>
  <h1>{{.Pod}}</h1>
  <dl>
    <dt>node</dt><dd>{{.Node}}</dd>
    <dt>pod ip</dt><dd>{{.IP}}</dd>
    <dt>requests served</dt><dd>{{.Served}}</dd>
    <dt>version</dt><dd><span class="v">{{.Version}}</span></dd>
  </dl>
</main></body></html>`))

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "ok")
	})
	mux.HandleFunc("/api", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(whoami())
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		page.Execute(w, whoami())
	})

	srv := &http.Server{Addr: ":8080", Handler: mux}
	go func() {
		log.Printf("whoami %s listening on :8080", version)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	// Kubernetes sends SIGTERM before removing a pod. Keep serving for a
	// moment so in-flight traffic drains while the pod leaves the Service.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	time.Sleep(4 * time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
