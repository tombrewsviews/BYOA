/**
 * The form panel: per-transfer inputs that drive remit.json. Grouped as
 * Transfer / Recipient / Bank / Amount / Options. The fixed sender block
 * (Design Drives Growth) isn't editable here — only the sender ACCOUNT toggle.
 */
import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Charge,
  Purpose,
  RemitDoc,
  SenderAccount,
  TransferType,
} from "./schema";
import { SENDER_ACCOUNTS } from "./schema";

type Update = (patch: (d: RemitDoc) => RemitDoc) => void;

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex flex-col gap-1">
    <Label className="text-xs text-muted-foreground">{label}</Label>
    {children}
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="flex flex-col gap-3 border-b border-border pb-4">
    <div className="text-xs font-semibold uppercase tracking-wide text-foreground">
      {title}
    </div>
    {children}
  </div>
);

export const FormPanel: React.FC<{ doc: RemitDoc; onChange: Update }> = ({
  doc,
  onChange,
}) => {
  const setText =
    (path: (d: RemitDoc, v: string) => RemitDoc) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange((d) => path(d, e.target.value));

  return (
    <div className="flex flex-col gap-4 overflow-auto p-4 text-foreground">
      <Section title="Transfer">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input
              type="date"
              value={doc.date}
              onChange={setText((d, v) => ({ ...d, date: v }))}
            />
          </Field>
          <Field label="Type">
            <Select
              value={doc.transferType}
              onValueChange={(v) =>
                onChange((d) => ({ ...d, transferType: v as TransferType }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FTT">FTT (Foreign Telegraphic)</SelectItem>
                <SelectItem value="RENTAS">RENTAS</SelectItem>
                <SelectItem value="GIRO">GIRO</SelectItem>
                <SelectItem value="CHEQUE">Banker's Cheque</SelectItem>
                <SelectItem value="OTHER">Others</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Sender account">
          <Select
            value={doc.senderAccount}
            onValueChange={(v) =>
              onChange((d) => ({ ...d, senderAccount: v as SenderAccount }))
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MYR">MYR · {SENDER_ACCOUNTS.MYR}</SelectItem>
              <SelectItem value="USD">USD · {SENDER_ACCOUNTS.USD}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section title="Recipient">
        <Field label="Name">
          <Input
            value={doc.recipient.name}
            onChange={setText((d, v) => ({
              ...d,
              recipient: { ...d.recipient, name: v },
            }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ID No.">
            <Input
              value={doc.recipient.id}
              onChange={setText((d, v) => ({
                ...d,
                recipient: { ...d.recipient, id: v },
              }))}
            />
          </Field>
          <Field label="Tel">
            <Input
              value={doc.recipient.tel}
              onChange={setText((d, v) => ({
                ...d,
                recipient: { ...d.recipient, tel: v },
              }))}
            />
          </Field>
        </div>
        <Field label="Address">
          <Input
            value={doc.recipient.address}
            onChange={setText((d, v) => ({
              ...d,
              recipient: { ...d.recipient, address: v },
            }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Residency">
            <Select
              value={doc.recipient.residency}
              onValueChange={(v) =>
                onChange((d) => ({
                  ...d,
                  recipient: {
                    ...d.recipient,
                    residency: v === "resident" ? "resident" : "non-resident",
                  },
                }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="resident">Resident</SelectItem>
                <SelectItem value="non-resident">Non-Resident</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-end gap-2 pb-1">
            <Switch
              checked={doc.recipient.isOrganisation}
              onCheckedChange={(c) =>
                onChange((d) => ({
                  ...d,
                  recipient: { ...d.recipient, isOrganisation: c },
                }))
              }
            />
            <Label className="text-xs text-muted-foreground">Organisation</Label>
          </div>
        </div>
      </Section>

      <Section title="Recipient bank">
        <Field label="Bank name">
          <Input
            value={doc.bank.name}
            onChange={setText((d, v) => ({ ...d, bank: { ...d.bank, name: v } }))}
          />
        </Field>
        <Field label="Account no.">
          <Input
            value={doc.bank.account}
            onChange={setText((d, v) => ({ ...d, bank: { ...d.bank, account: v } }))}
          />
        </Field>
        <Field label="Bank address">
          <Input
            value={doc.bank.address}
            onChange={setText((d, v) => ({ ...d, bank: { ...d.bank, address: v } }))}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Town">
            <Input
              value={doc.bank.town}
              onChange={setText((d, v) => ({ ...d, bank: { ...d.bank, town: v } }))}
            />
          </Field>
          <Field label="Country">
            <Input
              value={doc.bank.country}
              onChange={setText((d, v) => ({ ...d, bank: { ...d.bank, country: v } }))}
            />
          </Field>
          <Field label="SWIFT">
            <Input
              value={doc.bank.swift}
              onChange={setText((d, v) => ({ ...d, bank: { ...d.bank, swift: v } }))}
            />
          </Field>
        </div>
        <Field label="Payment details">
          <Input
            value={doc.payment.details}
            onChange={setText((d, v) => ({ ...d, payment: { details: v } }))}
          />
        </Field>
      </Section>

      <Section title="Amount">
        <Field label={`Value (${doc.senderAccount} — ${doc.senderAccount === "MYR" ? "In RM" : "In Foreign Currency"})`}>
          <Input
            placeholder="10,000.00"
            value={doc.amount.value}
            onChange={setText((d, v) => ({ ...d, amount: { value: v } }))}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          The slot (RM vs foreign currency) follows the sender account above.
        </p>
      </Section>

      <Section title="Options">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Charge">
            <Select
              value={doc.charge}
              onValueChange={(v) => onChange((d) => ({ ...d, charge: v as Charge }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SHA">SHA</SelectItem>
                <SelectItem value="OUR">OUR</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Purpose">
            <Select
              value={doc.purpose}
              onValueChange={(v) => onChange((d) => ({ ...d, purpose: v as Purpose }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GOODS">Goods</SelectItem>
                <SelectItem value="DERIVATIVES">Derivatives</SelectItem>
                <SelectItem value="SERVICES">Services</SelectItem>
                <SelectItem value="OWN_FUNDS">Own Funds Transfer</SelectItem>
                <SelectItem value="CAPITAL">Capital Transaction</SelectItem>
                <SelectItem value="FOREX">Forex Trading</SelectItem>
                <SelectItem value="OTHER">Other Transfer</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={doc.stampSignature}
            onCheckedChange={(c) => onChange((d) => ({ ...d, stampSignature: c }))}
          />
          <Label className="text-xs text-muted-foreground">Stamp signature</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={doc.checkDeclaration}
            onCheckedChange={(c) => onChange((d) => ({ ...d, checkDeclaration: c }))}
          />
          <Label className="text-xs text-muted-foreground">Check declaration</Label>
        </div>
      </Section>
    </div>
  );
};
