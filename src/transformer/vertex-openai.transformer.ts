import { UnifiedChatRequest } from "../types/llm";
import { Transformer, TransformerOptions } from "../types/transformer";
import { GoogleAuth } from "google-auth-library";

export class VertexOpenaiTransformer implements Transformer {
  static TransformerName = "vertex-openai";

  client: any;
  client_email: string;
  private_key: string;

  constructor(options: TransformerOptions) {
    this.client_email = options.client_email;
    this.private_key = options.private_key.replace(/\\n/g, "\n");
  }

  async getClient() {
    if (this.client) return this.client;
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      credentials: {
        client_email: this.client_email,
        private_key: this.private_key,
      },
    });
    this.client = await auth.getClient();
    return this.client;
  }

  async transformRequestIn(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatRequest> {
    const client = await this.getClient()
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Failed to get access token");
    return {
      body: request,
      config: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    };
  }
}
