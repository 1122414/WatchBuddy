const DEVICE_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]{8,64}$/;
const TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{32,64}$/;
const PET_ID_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PET_ASSET_ID_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PET_VERSION_PATTERN: RegExp = /^sha256-[a-f0-9]{16}$/;
const SHA256_PATTERN: RegExp = /^[a-f0-9]{64}$/;
const MAX_PET_ASSETS: number = 88;
const MAX_PET_ASSET_BYTES: number = 7 * 1024;
const MAX_ACTIVE_PET_BYTES: number = 2 * 1024 * 1024;

interface HealthPayload {
  ok: boolean;
  service: string;
  version: string;
  time: string;
}

interface RegistrationPayload {
  deviceId: string;
  deviceToken: string;
  registeredAt: number;
}

interface CompanionStatePayload {
  characterState: string;
  serverTime: number;
  nextCheckAt: number;
  settings: SettingsPayload;
  nudge: CompanionNudgePayload | null;
}

interface SettingsPayload {
  quietMode: boolean;
}

interface NudgeActionPayload {
  id: string;
  label: string;
}

interface CompanionNudgePayload {
  schemaVersion: number;
  type: string;
  nudgeId: string;
  source: string;
  intensity: number;
  characterState: string;
  message: string;
  actions: Array<NudgeActionPayload>;
  createdAt: number;
  expiresAt: number;
}

interface ReplyPayload {
  accepted: boolean;
  characterState: string;
  nextCheckAt: number;
  reply: Object;
}

interface MemoryPayload {
  id: string;
  type: string;
  summary: string;
  sensitivity: string;
  updatedAt: number;
}

interface MemoryPagePayload {
  memories: Array<MemoryPayload>;
  hasMore: boolean;
  nextOffset: number;
}

interface DeleteMemoryPayload {
  deleted: boolean;
  memoryId: string;
}

interface ClearMemoriesPayload {
  deleted: number;
}

interface PetAssetDescriptorPayload {
  id?: string;
  assetId?: string;
  bytes: number;
  mediaType: string;
  sha256: string;
  url: string;
  base64Url: string;
}

interface PetBudgetPayload {
  frameCount: number;
  totalBytes: number;
  maxFrameBytes: number;
}

interface PetFramePayload {
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
}

interface PetAnimationPayload {
  frames: Array<string>;
  durationsMs: Array<number>;
  loop: boolean;
}

interface PetAnimationsPayload {
  idle: PetAnimationPayload;
  runningRight: PetAnimationPayload;
  runningLeft: PetAnimationPayload;
  waving: PetAnimationPayload;
  jumping: PetAnimationPayload;
  failed: PetAnimationPayload;
  waiting: PetAnimationPayload;
  running: PetAnimationPayload;
  review: PetAnimationPayload;
}

interface PetStateMappingPayload {
  sleeping: string;
  idle: string;
  daydreaming: string;
  watching: string;
  curious: string;
  concerned: string;
  chatting: string;
  giving_space: string;
}

interface PetInteractionMappingPayload {
  tap: string;
  message: string;
  loading: string;
  failure: string;
}

interface PetSourceLicensePayload {
  name: string;
  url: string;
  redistributionAllowed: boolean;
}

interface PetSourcePayload {
  format: string;
  spriteVersionNumber: number;
  author: string;
  sourceUrl: string;
  sha256: string;
  license: PetSourceLicensePayload;
  attribution: string;
}

interface PetSummaryPayload {
  id: string;
  displayName: string;
  description: string;
  renderer: string;
  version: string;
  manifestSha256: string;
  assetCount: number;
  budget: PetBudgetPayload;
  frame: PetFramePayload;
  metadataUrl: string;
  assetsUrl: string;
  preview: PetAssetDescriptorPayload;
}

interface PetDetailPayload extends PetSummaryPayload {
  animations: PetAnimationsPayload;
  fallbackFrame: string;
  stateMap: PetStateMappingPayload;
  interactionMap: PetInteractionMappingPayload;
  source: PetSourcePayload;
}

interface PetCatalogPayload {
  catalogSchemaVersion: number;
  pets: Array<PetSummaryPayload>;
}

interface PetDetailResponsePayload {
  catalogSchemaVersion: number;
  pet: PetDetailPayload;
}

interface PetAssetPagePayload {
  catalogSchemaVersion: number;
  petId: string;
  version: string;
  assets: Array<PetAssetDescriptorPayload>;
  hasMore: boolean;
  nextOffset: number;
  total: number;
}

interface PetAssetPayload {
  id: string;
  bytes: number;
  mediaType: string;
  sha256: string;
  encoding: string;
  data: string;
}

interface PetAssetResponsePayload {
  catalogSchemaVersion: number;
  asset: PetAssetPayload;
}

export class HealthResult {
  version: string;
  time: string;

  constructor(version: string, time: string) {
    this.version = version;
    this.time = time;
  }
}

export class DeviceRegistration {
  deviceId: string;
  deviceToken: string;
  registeredAt: number;

  constructor(deviceId: string, deviceToken: string, registeredAt: number) {
    this.deviceId = deviceId;
    this.deviceToken = deviceToken;
    this.registeredAt = registeredAt;
  }
}

export class CompanionSnapshot {
  characterState: string;
  serverTime: number;
  nextCheckAt: number;
  quietMode: boolean;
  nudge: CompanionNudge | null;

  constructor(
    characterState: string,
    serverTime: number,
    nextCheckAt: number,
    quietMode: boolean,
    nudge: CompanionNudge | null
  ) {
    this.characterState = characterState;
    this.serverTime = serverTime;
    this.nextCheckAt = nextCheckAt;
    this.quietMode = quietMode;
    this.nudge = nudge;
  }
}

export class NudgeAction {
  id: string;
  label: string;

  constructor(id: string, label: string) {
    this.id = id;
    this.label = label;
  }
}

export class CompanionNudge {
  nudgeId: string;
  message: string;
  actions: Array<NudgeAction>;
  createdAt: number;
  expiresAt: number;

  constructor(
    nudgeId: string,
    message: string,
    actions: Array<NudgeAction>,
    createdAt: number,
    expiresAt: number
  ) {
    this.nudgeId = nudgeId;
    this.message = message;
    this.actions = actions;
    this.createdAt = createdAt;
    this.expiresAt = expiresAt;
  }
}

export class SettingsResult {
  quietMode: boolean;

  constructor(quietMode: boolean) {
    this.quietMode = quietMode;
  }
}

export class ReplyResult {
  characterState: string;
  nextCheckAt: number;

  constructor(characterState: string, nextCheckAt: number) {
    this.characterState = characterState;
    this.nextCheckAt = nextCheckAt;
  }
}

export class MemoryItem {
  id: string;
  type: string;
  summary: string;
  sensitivity: string;
  updatedAt: number;

  constructor(
    id: string,
    type: string,
    summary: string,
    sensitivity: string,
    updatedAt: number
  ) {
    this.id = id;
    this.type = type;
    this.summary = summary;
    this.sensitivity = sensitivity;
    this.updatedAt = updatedAt;
  }
}

export class MemoryPage {
  memories: Array<MemoryItem>;
  hasMore: boolean;
  nextOffset: number;

  constructor(
    memories: Array<MemoryItem>,
    hasMore: boolean,
    nextOffset: number
  ) {
    this.memories = memories;
    this.hasMore = hasMore;
    this.nextOffset = nextOffset;
  }
}

export class PetAssetDescriptor {
  id: string;
  bytes: number;
  mediaType: string;
  sha256: string;
  url: string;
  base64Url: string;

  constructor(
    id: string,
    bytes: number,
    mediaType: string,
    sha256: string,
    url: string,
    base64Url: string
  ) {
    this.id = id;
    this.bytes = bytes;
    this.mediaType = mediaType;
    this.sha256 = sha256;
    this.url = url;
    this.base64Url = base64Url;
  }
}

export class PetBudget {
  frameCount: number;
  totalBytes: number;
  maxFrameBytes: number;

  constructor(frameCount: number, totalBytes: number, maxFrameBytes: number) {
    this.frameCount = frameCount;
    this.totalBytes = totalBytes;
    this.maxFrameBytes = maxFrameBytes;
  }
}

export class PetFrame {
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;

  constructor(
    width: number,
    height: number,
    displayWidth: number,
    displayHeight: number
  ) {
    this.width = width;
    this.height = height;
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
  }
}

export class PetAnimationDefinition {
  frames: Array<string>;
  durationsMs: Array<number>;
  loop: boolean;

  constructor(
    frames: Array<string>,
    durationsMs: Array<number>,
    loop: boolean
  ) {
    this.frames = frames;
    this.durationsMs = durationsMs;
    this.loop = loop;
  }
}

export class PetAnimations {
  idle: PetAnimationDefinition;
  runningRight: PetAnimationDefinition;
  runningLeft: PetAnimationDefinition;
  waving: PetAnimationDefinition;
  jumping: PetAnimationDefinition;
  failed: PetAnimationDefinition;
  waiting: PetAnimationDefinition;
  running: PetAnimationDefinition;
  review: PetAnimationDefinition;

  constructor(payload: PetAnimationsPayload) {
    this.idle = createPetAnimation(payload.idle);
    this.runningRight = createPetAnimation(payload.runningRight);
    this.runningLeft = createPetAnimation(payload.runningLeft);
    this.waving = createPetAnimation(payload.waving);
    this.jumping = createPetAnimation(payload.jumping);
    this.failed = createPetAnimation(payload.failed);
    this.waiting = createPetAnimation(payload.waiting);
    this.running = createPetAnimation(payload.running);
    this.review = createPetAnimation(payload.review);
  }

  get(name: string): PetAnimationDefinition {
    switch (name) {
      case 'runningRight':
        return this.runningRight;
      case 'runningLeft':
        return this.runningLeft;
      case 'waving':
        return this.waving;
      case 'jumping':
        return this.jumping;
      case 'failed':
        return this.failed;
      case 'waiting':
        return this.waiting;
      case 'running':
        return this.running;
      case 'review':
        return this.review;
      default:
        return this.idle;
    }
  }
}

export class PetStateMapping {
  sleeping: string;
  idle: string;
  daydreaming: string;
  watching: string;
  curious: string;
  concerned: string;
  chatting: string;
  giving_space: string;

  constructor(payload: PetStateMappingPayload) {
    this.sleeping = payload.sleeping;
    this.idle = payload.idle;
    this.daydreaming = payload.daydreaming;
    this.watching = payload.watching;
    this.curious = payload.curious;
    this.concerned = payload.concerned;
    this.chatting = payload.chatting;
    this.giving_space = payload.giving_space;
  }

  get(state: string): string {
    switch (state) {
      case 'sleeping':
        return this.sleeping;
      case 'daydreaming':
        return this.daydreaming;
      case 'watching':
        return this.watching;
      case 'curious':
        return this.curious;
      case 'concerned':
        return this.concerned;
      case 'chatting':
        return this.chatting;
      case 'giving_space':
        return this.giving_space;
      default:
        return this.idle;
    }
  }
}

export class PetInteractionMapping {
  tap: string;
  message: string;
  loading: string;
  failure: string;

  constructor(payload: PetInteractionMappingPayload) {
    this.tap = payload.tap;
    this.message = payload.message;
    this.loading = payload.loading;
    this.failure = payload.failure;
  }

  get(interaction: string): string {
    switch (interaction) {
      case 'tap':
        return this.tap;
      case 'message':
        return this.message;
      case 'loading':
        return this.loading;
      case 'failure':
        return this.failure;
      default:
        return this.tap;
    }
  }
}

export class PetSummary {
  id: string;
  displayName: string;
  description: string;
  renderer: string;
  version: string;
  manifestSha256: string;
  assetCount: number;
  budget: PetBudget;
  frame: PetFrame;
  metadataUrl: string;
  assetsUrl: string;
  preview: PetAssetDescriptor;

  constructor(payload: PetSummaryPayload) {
    this.id = payload.id;
    this.displayName = payload.displayName;
    this.description = payload.description;
    this.renderer = payload.renderer;
    this.version = payload.version;
    this.manifestSha256 = payload.manifestSha256;
    this.assetCount = payload.assetCount;
    this.budget = new PetBudget(
      payload.budget.frameCount,
      payload.budget.totalBytes,
      payload.budget.maxFrameBytes
    );
    this.frame = new PetFrame(
      payload.frame.width,
      payload.frame.height,
      payload.frame.displayWidth,
      payload.frame.displayHeight
    );
    this.metadataUrl = payload.metadataUrl;
    this.assetsUrl = payload.assetsUrl;
    this.preview = createPetAssetDescriptor(payload.preview, payload.id);
  }
}

export class PetSourceLicense {
  name: string;
  url: string;
  redistributionAllowed: boolean;

  constructor(payload: PetSourceLicensePayload) {
    this.name = payload.name;
    this.url = payload.url;
    this.redistributionAllowed = payload.redistributionAllowed;
  }
}

export class PetSource {
  format: string;
  spriteVersionNumber: number;
  author: string;
  sourceUrl: string;
  sha256: string;
  license: PetSourceLicense;
  attribution: string;

  constructor(payload: PetSourcePayload) {
    this.format = payload.format;
    this.spriteVersionNumber = payload.spriteVersionNumber;
    this.author = payload.author;
    this.sourceUrl = payload.sourceUrl;
    this.sha256 = payload.sha256;
    this.license = new PetSourceLicense(payload.license);
    this.attribution = payload.attribution;
  }
}

export class PetDetail extends PetSummary {
  animations: PetAnimations;
  fallbackFrame: string;
  stateMap: PetStateMapping;
  interactionMap: PetInteractionMapping;
  source: PetSource;

  constructor(payload: PetDetailPayload) {
    super(payload);
    this.animations = new PetAnimations(payload.animations);
    this.fallbackFrame = payload.fallbackFrame;
    this.stateMap = new PetStateMapping(payload.stateMap);
    this.interactionMap = new PetInteractionMapping(payload.interactionMap);
    this.source = new PetSource(payload.source);
  }
}

export class PetCatalog {
  pets: Array<PetSummary>;

  constructor(pets: Array<PetSummary>) {
    this.pets = pets;
  }
}

export class PetAssetPage {
  assets: Array<PetAssetDescriptor>;
  hasMore: boolean;
  nextOffset: number;
  total: number;

  constructor(
    assets: Array<PetAssetDescriptor>,
    hasMore: boolean,
    nextOffset: number,
    total: number
  ) {
    this.assets = assets;
    this.hasMore = hasMore;
    this.nextOffset = nextOffset;
    this.total = total;
  }
}

export class PetAssetDownload {
  id: string;
  bytes: number;
  mediaType: string;
  sha256: string;
  data: string;

  constructor(
    id: string,
    bytes: number,
    mediaType: string,
    sha256: string,
    data: string
  ) {
    this.id = id;
    this.bytes = bytes;
    this.mediaType = mediaType;
    this.sha256 = sha256;
    this.data = data;
  }
}

export function parseHealthPayload(value: string): HealthResult {
  const payload: HealthPayload = JSON.parse(value) as HealthPayload;
  if (!payload
    || payload.ok !== true
    || payload.service !== 'watchbuddy-api'
    || typeof payload.version !== 'string'
    || payload.version.length < 1
    || payload.version.length > 32
    || typeof payload.time !== 'string'
    || payload.time.length < 1
    || payload.time.length > 64) {
    throw new Error('invalid_response');
  }
  return new HealthResult(payload.version, payload.time);
}

export function parseRegistrationPayload(value: string): DeviceRegistration {
  const payload: RegistrationPayload =
    JSON.parse(value) as RegistrationPayload;
  if (!payload
    || !DEVICE_ID_PATTERN.test(payload.deviceId)
    || !TOKEN_PATTERN.test(payload.deviceToken)
    || !Number.isSafeInteger(payload.registeredAt)) {
    throw new Error('invalid_response');
  }
  return new DeviceRegistration(
    payload.deviceId,
    payload.deviceToken,
    payload.registeredAt
  );
}

export function parseCompanionStatePayload(value: string): CompanionSnapshot {
  const payload: CompanionStatePayload =
    JSON.parse(value) as CompanionStatePayload;
  if (!payload
    || !isCharacterState(payload.characterState)
    || !Number.isSafeInteger(payload.serverTime)
    || !Number.isSafeInteger(payload.nextCheckAt)
    || payload.nextCheckAt <= payload.serverTime
    || !payload.settings
    || typeof payload.settings.quietMode !== 'boolean') {
    throw new Error('invalid_response');
  }
  const nudge: CompanionNudge | null =
    parseCompanionNudge(payload.nudge, payload.serverTime);
  return new CompanionSnapshot(
    payload.characterState,
    payload.serverTime,
    payload.nextCheckAt,
    payload.settings.quietMode,
    nudge
  );
}

export function parseSettingsPayload(value: string): SettingsResult {
  const payload: SettingsPayload = JSON.parse(value) as SettingsPayload;
  if (!payload
    || Object.keys(payload).length !== 1
    || typeof payload.quietMode !== 'boolean') {
    throw new Error('invalid_response');
  }
  return new SettingsResult(payload.quietMode);
}

export function parseReplyPayload(value: string): ReplyResult {
  const payload: ReplyPayload = JSON.parse(value) as ReplyPayload;
  if (!payload
    || payload.accepted !== true
    || !isCharacterState(payload.characterState)
    || !Number.isSafeInteger(payload.nextCheckAt)
    || !payload.reply
    || typeof payload.reply !== 'object') {
    throw new Error('invalid_response');
  }
  return new ReplyResult(payload.characterState, payload.nextCheckAt);
}

export function parseMemoryPagePayload(
  value: string,
  expectedOffset: number
): MemoryPage {
  const payload: MemoryPagePayload =
    JSON.parse(value) as MemoryPagePayload;
  if (!payload
    || !Array.isArray(payload.memories)
    || payload.memories.length > 20
    || typeof payload.hasMore !== 'boolean'
    || !Number.isInteger(payload.nextOffset)
    || payload.nextOffset !== expectedOffset + payload.memories.length
    || (payload.hasMore && payload.memories.length === 0)) {
    throw new Error('invalid_response');
  }
  const memories: Array<MemoryItem> = [];
  const memoryIds: Array<string> = [];
  for (let index: number = 0; index < payload.memories.length; index += 1) {
    const candidate: MemoryPayload = payload.memories[index];
    if (!isValidMemory(candidate) || memoryIds.includes(candidate.id)) {
      throw new Error('invalid_response');
    }
    memoryIds.push(candidate.id);
    memories.push(new MemoryItem(
      candidate.id,
      candidate.type,
      candidate.summary,
      candidate.sensitivity,
      candidate.updatedAt
    ));
  }
  return new MemoryPage(
    memories,
    payload.hasMore,
    payload.nextOffset
  );
}

export function parseDeleteMemoryPayload(
  value: string,
  expectedMemoryId: string
): boolean {
  const payload: DeleteMemoryPayload =
    JSON.parse(value) as DeleteMemoryPayload;
  if (!payload
    || payload.deleted !== true
    || payload.memoryId !== expectedMemoryId) {
    throw new Error('invalid_response');
  }
  return true;
}

export function parseClearMemoriesPayload(value: string): number {
  const payload: ClearMemoriesPayload =
    JSON.parse(value) as ClearMemoriesPayload;
  if (!payload
    || !Number.isInteger(payload.deleted)
    || payload.deleted < 0) {
    throw new Error('invalid_response');
  }
  return payload.deleted;
}

export function parsePetCatalogPayload(value: string): PetCatalog {
  const payload: PetCatalogPayload = JSON.parse(value) as PetCatalogPayload;
  if (!payload
    || payload.catalogSchemaVersion !== 1
    || !Array.isArray(payload.pets)
    || payload.pets.length < 1
    || payload.pets.length > 16) {
    throw new Error('invalid_response');
  }
  const pets: Array<PetSummary> = [];
  const petIds: Array<string> = [];
  for (let index: number = 0; index < payload.pets.length; index += 1) {
    const candidate: PetSummaryPayload = payload.pets[index];
    validatePetSummary(candidate);
    if (petIds.includes(candidate.id)) {
      throw new Error('invalid_response');
    }
    petIds.push(candidate.id);
    pets.push(new PetSummary(candidate));
  }
  return new PetCatalog(pets);
}

export function parsePetDetailPayload(
  value: string,
  expectedPetId: string
): PetDetail {
  const payload: PetDetailResponsePayload =
    JSON.parse(value) as PetDetailResponsePayload;
  if (!payload
    || payload.catalogSchemaVersion !== 1
    || !payload.pet
    || payload.pet.id !== expectedPetId) {
    throw new Error('invalid_response');
  }
  validatePetDetail(payload.pet);
  return new PetDetail(payload.pet);
}

export function parseStoredPetDetail(value: string): PetDetail {
  const payload: PetDetailPayload = JSON.parse(value) as PetDetailPayload;
  validatePetDetail(payload);
  return new PetDetail(payload);
}

export function parseStoredPetDescriptors(
  value: string,
  petId: string,
  expectedCount: number
): Array<PetAssetDescriptor> {
  const payload: Array<PetAssetDescriptorPayload> =
    JSON.parse(value) as Array<PetAssetDescriptorPayload>;
  if (!Array.isArray(payload)
    || payload.length !== expectedCount
    || payload.length < 1
    || payload.length > MAX_PET_ASSETS) {
    throw new Error('invalid_pet_asset_index');
  }
  const descriptors: Array<PetAssetDescriptor> = [];
  const ids: Array<string> = [];
  for (let index: number = 0; index < payload.length; index += 1) {
    validatePetAssetDescriptor(payload[index], petId);
    const assetId: string = descriptorId(payload[index]);
    if (ids.includes(assetId)) {
      throw new Error('invalid_pet_asset_index');
    }
    ids.push(assetId);
    descriptors.push(createPetAssetDescriptor(payload[index], petId));
  }
  return descriptors;
}

export function parsePetAssetPagePayload(
  value: string,
  expectedPetId: string,
  expectedVersion: string,
  expectedOffset: number
): PetAssetPage {
  const payload: PetAssetPagePayload =
    JSON.parse(value) as PetAssetPagePayload;
  if (!payload
    || payload.catalogSchemaVersion !== 1
    || payload.petId !== expectedPetId
    || payload.version !== expectedVersion
    || !Array.isArray(payload.assets)
    || payload.assets.length > 20
    || typeof payload.hasMore !== 'boolean'
    || !Number.isInteger(payload.nextOffset)
    || !Number.isInteger(payload.total)
    || payload.total < 1
    || payload.total > MAX_PET_ASSETS
    || payload.nextOffset !== expectedOffset + payload.assets.length
    || payload.nextOffset > payload.total
    || (payload.hasMore && payload.assets.length === 0)
    || (!payload.hasMore && payload.nextOffset !== payload.total)) {
    throw new Error('invalid_response');
  }
  const assets: Array<PetAssetDescriptor> = [];
  const assetIds: Array<string> = [];
  for (let index: number = 0; index < payload.assets.length; index += 1) {
    const candidate: PetAssetDescriptorPayload = payload.assets[index];
    validatePetAssetDescriptor(candidate, expectedPetId);
    const assetId: string = descriptorId(candidate);
    if (assetIds.includes(assetId)) {
      throw new Error('invalid_response');
    }
    assetIds.push(assetId);
    assets.push(createPetAssetDescriptor(candidate, expectedPetId));
  }
  return new PetAssetPage(
    assets,
    payload.hasMore,
    payload.nextOffset,
    payload.total
  );
}

export function parsePetAssetPayload(
  value: string,
  descriptor: PetAssetDescriptor
): PetAssetDownload {
  const payload: PetAssetResponsePayload =
    JSON.parse(value) as PetAssetResponsePayload;
  if (!payload
    || payload.catalogSchemaVersion !== 1
    || !payload.asset
    || payload.asset.id !== descriptor.id
    || payload.asset.bytes !== descriptor.bytes
    || payload.asset.mediaType !== descriptor.mediaType
    || payload.asset.sha256 !== descriptor.sha256
    || payload.asset.encoding !== 'base64'
    || typeof payload.asset.data !== 'string'
    || payload.asset.data.length < 4) {
    throw new Error('invalid_response');
  }
  return new PetAssetDownload(
    payload.asset.id,
    payload.asset.bytes,
    payload.asset.mediaType,
    payload.asset.sha256,
    payload.asset.data
  );
}

export function isCharacterState(value: string): boolean {
  switch (value) {
    case 'sleeping':
    case 'idle':
    case 'daydreaming':
    case 'watching':
    case 'curious':
    case 'concerned':
    case 'chatting':
    case 'giving_space':
      return true;
    default:
      return false;
  }
}

export function isValidDeviceId(value: string): boolean {
  return DEVICE_ID_PATTERN.test(value);
}

export function isValidDeviceToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function isValidPetId(value: string): boolean {
  return PET_ID_PATTERN.test(value);
}

export function isValidPetVersion(value: string): boolean {
  return PET_VERSION_PATTERN.test(value);
}

export function isValidPetAssetId(value: string): boolean {
  return PET_ASSET_ID_PATTERN.test(value);
}

function validatePetSummary(payload: PetSummaryPayload): void {
  if (!payload
    || !PET_ID_PATTERN.test(payload.id)
    || typeof payload.displayName !== 'string'
    || payload.displayName.length < 1
    || payload.displayName.length > 32
    || typeof payload.description !== 'string'
    || payload.description.length < 1
    || payload.description.length > 160
    || payload.renderer !== 'frame-sequence-v1'
    || !PET_VERSION_PATTERN.test(payload.version)
    || !SHA256_PATTERN.test(payload.manifestSha256)
    || payload.version !== `sha256-${payload.manifestSha256.slice(0, 16)}`
    || !Number.isInteger(payload.assetCount)
    || payload.assetCount < 1
    || payload.assetCount > MAX_PET_ASSETS
    || !isValidPetBudget(payload.budget, payload.assetCount)
    || !isValidPetFrame(payload.frame)
    || payload.metadataUrl !== `/v1/pets/${payload.id}`
    || payload.assetsUrl !== `/v1/pets/${payload.id}/assets`) {
    throw new Error('invalid_response');
  }
  validatePetAssetDescriptor(payload.preview, payload.id);
}

function validatePetDetail(payload: PetDetailPayload): void {
  validatePetSummary(payload);
  if (!payload.animations
    || Object.keys(payload.animations).length !== 9
    || !isValidPetAnimation(payload.animations.idle)
    || !isValidPetAnimation(payload.animations.runningRight)
    || !isValidPetAnimation(payload.animations.runningLeft)
    || !isValidPetAnimation(payload.animations.waving)
    || !isValidPetAnimation(payload.animations.jumping)
    || !isValidPetAnimation(payload.animations.failed)
    || !isValidPetAnimation(payload.animations.waiting)
    || !isValidPetAnimation(payload.animations.running)
    || !isValidPetAnimation(payload.animations.review)
    || !PET_ASSET_ID_PATTERN.test(payload.fallbackFrame)
    || payload.fallbackFrame !== descriptorId(payload.preview)
    || !isValidStateMapping(payload.stateMap)
    || !isValidInteractionMapping(payload.interactionMap)
    || !isValidPetSource(payload.source)) {
    throw new Error('invalid_response');
  }
  const animations: Array<string> = [
    'idle',
    'runningRight',
    'runningLeft',
    'waving',
    'jumping',
    'failed',
    'waiting',
    'running',
    'review'
  ];
  const stateMappings: Array<string> = [
    payload.stateMap.sleeping,
    payload.stateMap.idle,
    payload.stateMap.daydreaming,
    payload.stateMap.watching,
    payload.stateMap.curious,
    payload.stateMap.concerned,
    payload.stateMap.chatting,
    payload.stateMap.giving_space
  ];
  const interactionMappings: Array<string> = [
    payload.interactionMap.tap,
    payload.interactionMap.message,
    payload.interactionMap.loading,
    payload.interactionMap.failure
  ];
  if (!allValuesIncluded(stateMappings, animations)
    || !allValuesIncluded(interactionMappings, animations)) {
    throw new Error('invalid_response');
  }
}

function validatePetAssetDescriptor(
  payload: PetAssetDescriptorPayload,
  petId: string
): void {
  const assetId: string = descriptorId(payload);
  if (!payload
    || !PET_ASSET_ID_PATTERN.test(assetId)
    || payload.mediaType !== 'image/png'
    || !Number.isInteger(payload.bytes)
    || payload.bytes < 1
    || payload.bytes > MAX_PET_ASSET_BYTES
    || !SHA256_PATTERN.test(payload.sha256)
    || payload.url !== `/v1/pets/${petId}/assets/${assetId}`
    || payload.base64Url
      !== `/v1/pets/${petId}/assets/${assetId}?encoding=base64`) {
    throw new Error('invalid_response');
  }
}

function descriptorId(payload: PetAssetDescriptorPayload): string {
  if (!payload) {
    return '';
  }
  if (typeof payload.id === 'string') {
    return payload.id;
  }
  return typeof payload.assetId === 'string' ? payload.assetId : '';
}

function createPetAssetDescriptor(
  payload: PetAssetDescriptorPayload,
  petId: string
): PetAssetDescriptor {
  validatePetAssetDescriptor(payload, petId);
  return new PetAssetDescriptor(
    descriptorId(payload),
    payload.bytes,
    payload.mediaType,
    payload.sha256,
    payload.url,
    payload.base64Url
  );
}

function isValidPetBudget(
  payload: PetBudgetPayload,
  assetCount: number
): boolean {
  return !!payload
    && Number.isInteger(payload.frameCount)
    && payload.frameCount === assetCount
    && Number.isInteger(payload.totalBytes)
    && payload.totalBytes > 0
    && payload.totalBytes <= MAX_ACTIVE_PET_BYTES
    && Number.isInteger(payload.maxFrameBytes)
    && payload.maxFrameBytes > 0
    && payload.maxFrameBytes <= MAX_PET_ASSET_BYTES;
}

function isValidPetFrame(payload: PetFramePayload): boolean {
  return !!payload
    && Number.isInteger(payload.width)
    && payload.width >= 32
    && payload.width <= 192
    && Number.isInteger(payload.height)
    && payload.height >= 32
    && payload.height <= 208
    && Number.isInteger(payload.displayWidth)
    && payload.displayWidth >= 64
    && payload.displayWidth <= 200
    && Number.isInteger(payload.displayHeight)
    && payload.displayHeight >= 64
    && payload.displayHeight <= 200;
}

function isValidPetAnimation(payload: PetAnimationPayload): boolean {
  if (!payload
    || !Array.isArray(payload.frames)
    || payload.frames.length < 1
    || payload.frames.length > 8
    || !Array.isArray(payload.durationsMs)
    || payload.durationsMs.length !== payload.frames.length
    || typeof payload.loop !== 'boolean') {
    return false;
  }
  for (let index: number = 0; index < payload.frames.length; index += 1) {
    if (!PET_ASSET_ID_PATTERN.test(payload.frames[index])
      || !Number.isInteger(payload.durationsMs[index])
      || payload.durationsMs[index] < 60
      || payload.durationsMs[index] > 1000) {
      return false;
    }
  }
  return true;
}

function createPetAnimation(
  payload: PetAnimationPayload
): PetAnimationDefinition {
  return new PetAnimationDefinition(
    payload.frames,
    payload.durationsMs,
    payload.loop
  );
}

function isValidStateMapping(payload: PetStateMappingPayload): boolean {
  return !!payload
    && Object.keys(payload).length === 8
    && typeof payload.sleeping === 'string'
    && typeof payload.idle === 'string'
    && typeof payload.daydreaming === 'string'
    && typeof payload.watching === 'string'
    && typeof payload.curious === 'string'
    && typeof payload.concerned === 'string'
    && typeof payload.chatting === 'string'
    && typeof payload.giving_space === 'string';
}

function isValidInteractionMapping(
  payload: PetInteractionMappingPayload
): boolean {
  return !!payload
    && Object.keys(payload).length === 4
    && typeof payload.tap === 'string'
    && typeof payload.message === 'string'
    && typeof payload.loading === 'string'
    && typeof payload.failure === 'string';
}

function isValidPetSource(payload: PetSourcePayload): boolean {
  return !!payload
    && payload.format === 'codex-pet-v2'
    && payload.spriteVersionNumber === 2
    && typeof payload.author === 'string'
    && payload.author.length >= 1
    && payload.author.length <= 80
    && isHttpsUrl(payload.sourceUrl)
    && SHA256_PATTERN.test(payload.sha256)
    && !!payload.license
    && typeof payload.license.name === 'string'
    && payload.license.name.length >= 1
    && isHttpsUrl(payload.license.url)
    && payload.license.redistributionAllowed === true
    && typeof payload.attribution === 'string'
    && payload.attribution.length >= 1
    && payload.attribution.length <= 240;
}

function isHttpsUrl(value: string): boolean {
  return typeof value === 'string'
    && value.length <= 512
    && /^https:\/\/[^/?#]+(?:[/?#]|$)/.test(value)
    && !value.includes('@');
}

function parseCompanionNudge(
  payload: CompanionNudgePayload | null,
  serverTime: number
): CompanionNudge | null {
  if (payload === null) {
    return null;
  }
  if (!payload
    || payload.schemaVersion !== 1
    || payload.type !== 'COMPANION_NUDGE'
    || typeof payload.nudgeId !== 'string'
    || payload.nudgeId.length < 8
    || payload.nudgeId.length > 64
    || !isInitiativeSource(payload.source)
    || !Number.isInteger(payload.intensity)
    || payload.intensity < 0
    || payload.intensity > 4
    || !isCharacterState(payload.characterState)
    || typeof payload.message !== 'string'
    || payload.message.length < 1
    || payload.message.length > 76
    || !Number.isSafeInteger(payload.createdAt)
    || !Number.isSafeInteger(payload.expiresAt)
    || payload.createdAt > serverTime
    || payload.expiresAt <= serverTime
    || !Array.isArray(payload.actions)
    || payload.actions.length < 2
    || payload.actions.length > 4) {
    throw new Error('invalid_response');
  }
  const actions: Array<NudgeAction> = [];
  const actionIds: Array<string> = [];
  for (let index: number = 0; index < payload.actions.length; index += 1) {
    const action: NudgeActionPayload = payload.actions[index];
    if (!action
      || typeof action.id !== 'string'
      || !/^[A-Za-z0-9_-]{1,24}$/.test(action.id)
      || typeof action.label !== 'string'
      || action.label.length < 1
      || action.label.length > 24
      || actionIds.includes(action.id)) {
      throw new Error('invalid_response');
    }
    actionIds.push(action.id);
    actions.push(new NudgeAction(action.id, action.label));
  }
  return new CompanionNudge(
    payload.nudgeId,
    payload.message,
    actions,
    payload.createdAt,
    payload.expiresAt
  );
}

function isInitiativeSource(value: string): boolean {
  return value === 'daily_routine'
    || value === 'random_social'
    || value === 'relationship_follow_up'
    || value === 'user_state'
    || value === 'companion_internal';
}

function isValidMemory(payload: MemoryPayload): boolean {
  return !!payload
    && typeof payload.id === 'string'
    && payload.id.length >= 8
    && payload.id.length <= 128
    && !payload.id.includes('/')
    && (payload.type === 'event'
      || payload.type === 'preference'
      || payload.type === 'unfinished_topic'
      || payload.type === 'ritual')
    && typeof payload.summary === 'string'
    && payload.summary.trim().length > 0
    && payload.summary.length <= 128
    && (payload.sensitivity === 'normal'
      || payload.sensitivity === 'private'
      || payload.sensitivity === 'sensitive')
    && Number.isSafeInteger(payload.updatedAt);
}

function allValuesIncluded(
  values: Array<string>,
  allowed: Array<string>
): boolean {
  for (let index: number = 0; index < values.length; index += 1) {
    if (!allowed.includes(values[index])) {
      return false;
    }
  }
  return true;
}
