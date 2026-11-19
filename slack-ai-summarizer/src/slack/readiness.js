const requiredScopes = ['chat:write', 'users:read', 'im:write', 'im:read', 'im:history'];
async function checkSlackReadiness(client, recipient, env = process.env) {
  const auth = await client.auth.test();
  const scopes = auth.response_metadata?.scopes || [];
  const missingScopes = requiredScopes.filter(s => !scopes.includes(s));
  const workspaceVerified = auth.ok === true && auth.team_id === recipient.teamId && auth.team_id === env.SARDINES_SLACK_TEAM_ID;
  let recipientVerified = false;
  if (workspaceVerified && scopes.includes('users:read')) {
    const result = await client.users.info({ user: recipient.userId }); const u = result.user;
    recipientVerified = result.ok === true && u?.id === recipient.userId && u.team_id === recipient.teamId && !u.deleted && !u.is_bot && !u.is_app_user && !u.is_restricted && !u.is_ultra_restricted;
  }
  return { apiReady: workspaceVerified && recipientVerified && !missingScopes.length, workspaceVerified, recipientVerified,
    scopes, missingScopes, eventSubscription: 'Verify message.im and Enable Events in Slack app settings; bot scopes do not prove subscriptions', writes: 0 };
}
module.exports = { requiredScopes, checkSlackReadiness };
