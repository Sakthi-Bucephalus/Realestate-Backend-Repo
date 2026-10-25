const EventEmitter = require('events');

class RealtimeBroadcaster extends EventEmitter {}
const broadcaster = new RealtimeBroadcaster();

// Increase max listeners for multi-client connections
broadcaster.setMaxListeners(200);

/**
 * Broadcast an event to all connected SSE clients of a specific organization
 */
const broadcastToOrganization = (organizationId, eventName, payload) => {
  if (!organizationId) return;
  broadcaster.emit(`org:${String(organizationId)}`, {
    event: eventName,
    data: payload,
    timestamp: new Date().toISOString(),
  });
};

/**
 * SSE Endpoint Handler: handles streaming responses to authorized clients
 */
const handleSseConnection = (req, res) => {
  // Set SSE HTTP response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable buffering for Nginx if present
  });

  const orgId = String(req.organizationId);

  // Send initial connected acknowledgement
  res.write(`event: connected\ndata: ${JSON.stringify({ success: true, organizationId: orgId, time: new Date() })}\n\n`);

  // Event handler for organization broadcasts
  const eventListener = (msg) => {
    try {
      res.write(`event: ${msg.event}\ndata: ${JSON.stringify(msg.data)}\n\n`);
    } catch (err) {
      console.error('[SSE] Failed to write message to client stream:', err.message);
    }
  };

  const channel = `org:${orgId}`;
  broadcaster.on(channel, eventListener);

  // Send heartbeat keep-alive comment every 25 seconds
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': keep-alive ping\n\n');
    } catch {
      clearInterval(heartbeatInterval);
    }
  }, 25000);

  // Clean up on connection close or network disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    broadcaster.removeListener(channel, eventListener);
  });
};

module.exports = {
  broadcaster,
  broadcastToOrganization,
  handleSseConnection,
};
