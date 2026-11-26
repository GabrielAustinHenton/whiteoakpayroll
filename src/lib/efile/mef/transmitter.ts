import type { MefPackage } from "./94x";

/**
 * MeF Application-to-Application (A2A) transmission. The IRS provides the A2A toolkit (Java/.NET
 * SOAP) to approved transmitters; services include login, send submissions and get
 * acknowledgements, with strong authentication by an e-Services system certificate. Until
 * White Oak Payroll has an ETIN and A2A credentials, returns can only be built and validated.
 */
export interface MefAck {
  submissionId: string;
  status: "accepted" | "rejected";
  errors: { ruleNumber: string; message: string; xpath?: string }[];
}

export interface MefTransmitter {
  /** Sends a batch (a message attachment of submission zips); returns the IRS message ID. */
  send(packages: MefPackage[], opts: { test: boolean }): Promise<{ messageId: string }>;
  /** New acknowledgements since the last call. */
  getNewAcks(): Promise<MefAck[]>;
}

export class MefNotConfigured implements MefTransmitter {
  async send(): Promise<{ messageId: string }> {
    throw new Error(
      "MeF transmission is not set up: White Oak Payroll needs an approved IRS e-file application (EFIN/ETIN), an ATS-issued software ID and A2A credentials. See docs/registrations.md.",
    );
  }
  async getNewAcks(): Promise<MefAck[]> {
    return [];
  }
}
