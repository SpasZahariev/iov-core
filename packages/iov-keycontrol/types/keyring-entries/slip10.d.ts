import { PrehashType, SignableBytes } from "@iov/bcp-types";
import { Slip10Curve, Slip10RawIndex } from "@iov/crypto";
import { ChainId, SignatureBytes } from "@iov/tendermint-types";
import { KeyringEntry, KeyringEntryId, KeyringEntryImplementationIdString, KeyringEntrySerializationString, LocalIdentity, PublicIdentity } from "../keyring";
import { ValueAndUpdates } from "../valueandupdates";
interface Slip10KeyringEntryConstructor {
    new (data: KeyringEntrySerializationString): Slip10KeyringEntry;
}
export declare class Slip10KeyringEntry implements KeyringEntry {
    static fromEntropyWithCurve(curve: Slip10Curve, bip39Entropy: Uint8Array, cls?: Slip10KeyringEntryConstructor): Slip10KeyringEntry;
    static fromMnemonicWithCurve(curve: Slip10Curve, mnemonicString: string, cls?: Slip10KeyringEntryConstructor): Slip10KeyringEntry;
    private static readonly idsPrng;
    private static generateId;
    private static identityId;
    private static algorithmFromCurve;
    private static algorithmFromString;
    readonly label: ValueAndUpdates<string | undefined>;
    readonly canSign: ValueAndUpdates<boolean>;
    readonly implementationId: KeyringEntryImplementationIdString;
    readonly id: KeyringEntryId;
    private readonly secret;
    private readonly curve;
    private readonly identities;
    private readonly privkeyPaths;
    private readonly labelProducer;
    constructor(data: KeyringEntrySerializationString);
    setLabel(label: string | undefined): void;
    createIdentity(_: number): Promise<LocalIdentity>;
    createIdentityWithPath(path: ReadonlyArray<Slip10RawIndex>): Promise<LocalIdentity>;
    setIdentityLabel(identity: PublicIdentity, label: string | undefined): void;
    getIdentities(): ReadonlyArray<LocalIdentity>;
    createTransactionSignature(identity: PublicIdentity, transactionBytes: SignableBytes, prehashType: PrehashType, _: ChainId): Promise<SignatureBytes>;
    serialize(): KeyringEntrySerializationString;
    clone(): Slip10KeyringEntry;
    private privkeyPathForIdentity;
    private privkeyForIdentity;
    private buildLocalIdentity;
}
export {};
