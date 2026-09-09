/**
 * OAuth 2.1 Resource Server metadata (RFC 9728 + RFC 8707).
 *
 * MCP has classified servers as OAuth Resource Servers since 2025-06-18: the
 * server publishes a protected-resource document, and the client follows it to
 * whichever authorization server can mint a token for this resource. The
 * canonical `resource` value is also what the client must send as the RFC 8707
 * resource indicator, which is what stops a token minted for one MCP server
 * from being replayed against another.
 *
 * **Boundary — read this before assuming compliance.** This process does not
 * verify signatures or the `aud` claim: the JWT secret lives in the main
 * agent-world server, which is where the token is actually validated. What this
 * module adds is discovery (so a client can find the authorization server) and
 * a real 401 challenge (so `REQUIRE_AUTH=1` stops a local caller from riding
 * the server's own env token). Cryptographic validation stays delegated.
 */

export const OAUTH_METADATA_PATH = "/.well-known/oauth-protected-resource";

export interface OAuthConfig {
  /** Canonical resource URI clients pass as the RFC 8707 resource indicator. */
  resource: string;
  /** Authorization servers that can mint tokens for this resource. */
  authServers: string[];
  /** Refuse token-less requests instead of falling back to the env token. */
  requireAuth: boolean;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
  resource_documentation: string;
}

export function buildProtectedResourceMetadata(cfg: OAuthConfig): ProtectedResourceMetadata {
  return {
    resource: cfg.resource,
    authorization_servers: cfg.authServers,
    bearer_methods_supported: ["header"],
    scopes_supported: ["read", "write"],
    resource_documentation: "https://github.com/bayernjf/agent-world",
  };
}

/**
 * The `WWW-Authenticate` value for a 401. RFC 9728 §5.1 puts the metadata URL
 * in the challenge so an unauthenticated client can bootstrap discovery from a
 * single failed request.
 */
export function bearerChallenge(metadataUrl: string): string {
  return `Bearer resource_metadata="${metadataUrl}", error="invalid_token"`;
}
