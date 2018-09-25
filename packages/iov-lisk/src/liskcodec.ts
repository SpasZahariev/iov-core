// tslint:disable:no-bitwise
import Long from "long";

import {
  Address,
  Nonce,
  PrehashType,
  SignableBytes,
  SignedTransaction,
  SigningJob,
  TokenTicker,
  TransactionIdBytes,
  TransactionKind,
  TxCodec,
  UnsignedTransaction,
} from "@iov/bcp-types";
import { Sha256 } from "@iov/crypto";
import { Encoding, Uint64 } from "@iov/encoding";
import {
  Algorithm,
  ChainId,
  PostableBytes,
  PublicKeyBundle,
  PublicKeyBytes,
  SignatureBytes,
} from "@iov/tendermint-types";

function serializeTransaction(unsigned: UnsignedTransaction): Uint8Array {
  switch (unsigned.kind) {
    case TransactionKind.Send:
      const timestampBytes = new Uint8Array([
        (unsigned.timestamp! >> 0) & 0xff,
        (unsigned.timestamp! >> 8) & 0xff,
        (unsigned.timestamp! >> 16) & 0xff,
        (unsigned.timestamp! >> 24) & 0xff,
      ]);
      const amount = new Uint64(unsigned.amount.whole * 100000000 + unsigned.amount.fractional);
      const recipientString = Encoding.fromAscii(unsigned.recipient);
      if (!recipientString.match(/^[0-9]{1,20}L$/)) {
        throw new Error("Recipient does not match expected format");
      }

      if (recipientString !== "0L" && recipientString[0] === "0") {
        throw new Error("Recipient must not contain leading zeros");
      }

      const recipient = Uint64.fromString(recipientString.substring(0, recipientString.length - 1));

      const memoBytes = unsigned.memo !== undefined ? Encoding.toUtf8(unsigned.memo) : new Uint8Array([]);

      return new Uint8Array([
        0, // transaction type
        ...timestampBytes,
        ...unsigned.signer.data,
        ...recipient.toBytesBigEndian(),
        ...new Uint8Array(amount.toBytesBigEndian()).reverse(),
        ...memoBytes,
      ]);
    default:
      throw new Error("Unsupported kind of transaction");
  }
}

export const liskCodec: TxCodec = {
  /**
   * Transaction serialization as in
   * https://github.com/prolina-foundation/snapshot-validator/blob/35621c7/src/transaction.cpp#L36
   */
  bytesToSign: (unsigned: UnsignedTransaction, _: Nonce): SigningJob => ({
    bytes: serializeTransaction(unsigned) as SignableBytes,
    prehashType: PrehashType.None,
  }),

  /**
   * UTF-8 encoded JSON that can be posted to
   * https://app.swaggerhub.com/apis/LiskHQ/Lisk/1.0.30#/Transactions/postTransaction
   */
  bytesToPost: (_1: SignedTransaction): PostableBytes => {
    return new Uint8Array([]) as PostableBytes;
  },

  /**
   * Transaction ID as implemented in
   * https://github.com/prolina-foundation/snapshot-validator/blob/35621c7/src/transaction.cpp#L87
   */
  identifier: (signed: SignedTransaction): TransactionIdBytes => {
    const serialized = serializeTransaction(signed.transaction);
    const hash = new Sha256(serialized).update(signed.primarySignature.signature).digest();
    const idString = Long.fromBytesLE([...hash.slice(0, 8)], true).toString(10);
    return Encoding.toAscii(idString) as TransactionIdBytes;
  },

  /**
   * Recovers bytes (UTF-8 encoded JSON) from the blockchain into a format we can use
   */
  parseBytes: (_1: PostableBytes, _2: ChainId): SignedTransaction => {
    return {
      transaction: {
        chainId: "lisk-testnet" as ChainId,
        fee: {
          whole: 0,
          fractional: 1,
          tokenTicker: "LSK" as TokenTicker,
        },
        signer: {
          algo: Algorithm.ED25519,
          data: new Uint8Array([]) as PublicKeyBytes,
        },
        ttl: undefined,
        kind: TransactionKind.Send,
        amount: {
          whole: 3,
          fractional: 22,
          tokenTicker: "LSK" as TokenTicker,
        },
        recipient: new Uint8Array([]) as Address,
        memo: "lalala",
      },
      primarySignature: {
        nonce: new Long(0) as Nonce,
        publicKey: {
          algo: Algorithm.ED25519,
          data: new Uint8Array([]) as PublicKeyBytes,
        },
        signature: new Uint8Array([]) as SignatureBytes,
      },
      otherSignatures: [],
    };
  },

  /**
   * ASCII-encoded address string, e.g. 6076671634347365051L
   *
   * Addresses cannot be stored as raw uint64 because there are two types of recipient addresses
   * on the Lisk blockchain that cannot be encoded as uint64 :
   * 1. leading zeros make different addresses ("123L" != "000123L")
   * 2. some addresses exceed the uint64 range (e.g. "19961131544040416558L")
   * These are bugs we have to deal with.
   */
  keyToAddress: (pubkey: PublicKeyBundle): Address => {
    // https://github.com/prolina-foundation/snapshot-validator/blob/35621c7/src/lisk.cpp#L26
    const hash = new Sha256(pubkey.data).digest();
    const firstEightBytesReversed = hash.slice(0, 8).reverse();
    const addressString = Uint64.fromBigEndianBytes(firstEightBytesReversed).toString() + "L";
    return Encoding.toAscii(addressString) as Address;
  },
};
