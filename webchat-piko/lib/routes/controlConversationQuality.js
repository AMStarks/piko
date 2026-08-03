function handleConversationQualityRoute(req, res, pathname, metrics, send) {
  if (req.method !== 'GET' || pathname !== '/api/control/conversation-quality') return false;
  const conversation = metrics && metrics.conversation ? metrics.conversation : {};
  send(res, 200, JSON.stringify(conversation));
  return true;
}

module.exports = {
  handleConversationQualityRoute,
};
