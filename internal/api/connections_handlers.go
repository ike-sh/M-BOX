package api

import "net/http"

func (s *Server) handleConnections(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := reqCtx(r)
	defer cancel()
	raw, err := s.client.Connections(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	conns := transformConnections(raw)
	s.connSpeed.fill(conns)
	writeJSON(w, http.StatusOK, conns)
}

func (s *Server) handleCloseConnection(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ctx, cancel := reqCtx(r)
	defer cancel()
	if err := s.client.CloseConnection(ctx, id); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
