import { util } from '@kit.ArkTS';
import { asset } from '@kit.AssetStoreKit';

const TOKEN_ALIAS: string = 'watchbuddy-device-token-v1';
const PROBE_ALIAS: string = 'watchbuddy-asset-store-probe-v1';

export class SecureTokenStore {
  private encoder: util.TextEncoder = new util.TextEncoder();
  private decoder: util.TextDecoder = new util.TextDecoder('utf-8');

  async ensureAvailable(): Promise<void> {
    try {
      const attributes: asset.AssetMap = this.secretAttributes(
        PROBE_ALIAS,
        'probe'
      );
      await asset.add(attributes);
      const value: string = await this.query(PROBE_ALIAS);
      await this.remove(PROBE_ALIAS);
      if (value !== 'probe') {
        throw new Error('secure_store_unavailable');
      }
    } catch (error) {
      throw new Error('secure_store_unavailable');
    }
  }

  async load(): Promise<string> {
    try {
      return await this.query(TOKEN_ALIAS);
    } catch (error) {
      return '';
    }
  }

  async save(token: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
      throw new Error('invalid_token');
    }
    try {
      await asset.add(this.secretAttributes(TOKEN_ALIAS, token));
      const stored: string = await this.query(TOKEN_ALIAS);
      if (stored !== token) {
        throw new Error('secure_store_verify_failed');
      }
    } catch (error) {
      throw new Error('secure_store_verify_failed');
    }
  }

  async clear(): Promise<void> {
    try {
      await this.remove(TOKEN_ALIAS);
    } catch (error) {
    }
  }

  private secretAttributes(alias: string, secret: string): asset.AssetMap {
    const attributes: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    attributes.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias));
    attributes.set(asset.Tag.SECRET, this.encoder.encodeInto(secret));
    attributes.set(
      asset.Tag.ACCESSIBILITY,
      asset.Accessibility.DEVICE_FIRST_UNLOCKED
    );
    attributes.set(asset.Tag.AUTH_TYPE, asset.AuthType.NONE);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    attributes.set(
      asset.Tag.CONFLICT_RESOLUTION,
      asset.ConflictResolution.OVERWRITE
    );
    return attributes;
  }

  private async query(alias: string): Promise<string> {
    try {
      const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      query.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias));
      query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
      query.set(asset.Tag.RETURN_LIMIT, 1);
      const results: Array<asset.AssetMap> = await asset.query(query);
      if (results.length !== 1) {
        throw new Error('secure_store_not_found');
      }
      const secret: asset.Value | undefined =
        results[0].get(asset.Tag.SECRET);
      if (!(secret instanceof Uint8Array)) {
        throw new Error('secure_store_invalid');
      }
      return this.decoder.decodeToString(secret);
    } catch (error) {
      throw new Error('secure_store_not_found');
    }
  }

  private async remove(alias: string): Promise<void> {
    try {
      const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      query.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias));
      await asset.remove(query);
    } catch (error) {
      throw new Error('secure_store_remove_failed');
    }
  }
}
