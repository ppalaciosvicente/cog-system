"use client";

import forms from "@/styles/forms.module.css";

type CurrencyOption = {
  code: string;
  symbol: string;
};

type MemberOption = {
  value: number;
  label: string;
};

export type ContributionEditDraft = {
  id: number;
  memberId: string;
  memberLabel: string;
  amount: string;
  currencyCode: string;
  fundType: string;
  checkNo: string;
  contributionType: string;
  dateDeposited: string;
  dateEntered: string;
  batchNumber: string;
  comments: string;
};

type EditContributionDialogProps = {
  draft: ContributionEditDraft;
  error: string | null;
  saving: boolean;
  memberOptions: MemberOption[];
  memberOptionsLoading?: boolean;
  fundTypeOptions: string[];
  contributionTypeOptions: string[];
  currencyOptions: CurrencyOption[];
  onChange: (field: keyof ContributionEditDraft, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

function isCashFundType(value: string) {
  return value.trim().toLowerCase() === "cash";
}

export function EditContributionDialog({
  draft,
  error,
  saving,
  memberOptions,
  memberOptionsLoading = false,
  fundTypeOptions,
  contributionTypeOptions,
  currencyOptions,
  onChange,
  onCancel,
  onSave,
}: EditContributionDialogProps) {
  const hasCurrentMemberOption = memberOptions.some(
    (option) => String(option.value) === draft.memberId,
  );

  function handleFundTypeChange(value: string) {
    onChange("fundType", value);
    if (isCashFundType(value)) {
      onChange("checkNo", "");
    }
  }

  return (
    <div className={forms.modalBackdrop} role="dialog" aria-modal="true">
      <div className={forms.modalCard}>
        <h2 className={forms.modalTitle}>Edit Contribution</h2>
        <p className={forms.modalText}>Update the saved contribution and save your changes.</p>
        {error ? <p className={forms.error}>{error}</p> : null}
        <div className={forms.col}>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-member">
              Member
            </label>
            <div className={forms.control}>
              <select
                id="edit-contribution-member"
                className={forms.field}
                value={draft.memberId}
                disabled={memberOptionsLoading}
                onChange={(event) => onChange("memberId", event.target.value)}
              >
                <option value="">Select member</option>
                {draft.memberId && !hasCurrentMemberOption ? (
                  <option value={draft.memberId}>{draft.memberLabel || draft.memberId}</option>
                ) : null}
                {memberOptions.map((member) => (
                  <option key={member.value} value={member.value}>
                    {member.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-amount">
              Amount
            </label>
            <div className={forms.control}>
              <input
                id="edit-contribution-amount"
                className={forms.field}
                type="number"
                min="0"
                step="0.01"
                value={draft.amount}
                onChange={(event) => onChange("amount", event.target.value)}
              />
            </div>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-currency">
              Currency
            </label>
            <div className={forms.control}>
              <select
                id="edit-contribution-currency"
                className={forms.field}
                value={draft.currencyCode}
                onChange={(event) => onChange("currencyCode", event.target.value)}
              >
                <option value="">Select currency</option>
                {currencyOptions.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} ({currency.symbol})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-fund-type">
              Fund Type
            </label>
            <div className={forms.control}>
              <select
                id="edit-contribution-fund-type"
                className={forms.field}
                value={draft.fundType}
                onChange={(event) => handleFundTypeChange(event.target.value)}
              >
                <option value="">Select fund type</option>
                {fundTypeOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-check-no">
              Check No.
            </label>
            <div className={forms.control}>
              <input
                id="edit-contribution-check-no"
                className={forms.field}
                value={draft.checkNo}
                disabled={isCashFundType(draft.fundType)}
                onChange={(event) => onChange("checkNo", event.target.value)}
              />
            </div>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-type">
              Contribution Type
            </label>
            <div className={forms.control}>
              <select
                id="edit-contribution-type"
                className={forms.field}
                value={draft.contributionType}
                onChange={(event) => onChange("contributionType", event.target.value)}
              >
                <option value="">Select contribution type</option>
                {contributionTypeOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-date-deposited">
              Date Deposited
            </label>
            <div className={forms.control}>
              <input
                id="edit-contribution-date-deposited"
                type="date"
                className={forms.field}
                value={draft.dateDeposited}
                onChange={(event) => onChange("dateDeposited", event.target.value)}
              />
            </div>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-date-entered">
              Date Entered
            </label>
            <div className={forms.control}>
              <input
                id="edit-contribution-date-entered"
                type="date"
                className={forms.field}
                value={draft.dateEntered}
                onChange={(event) => onChange("dateEntered", event.target.value)}
              />
            </div>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-batch-number">
              Batch Number
            </label>
            <div className={forms.control}>
              <input
                id="edit-contribution-batch-number"
                type="number"
                min="1"
                step="1"
                className={forms.field}
                value={draft.batchNumber}
                onChange={(event) => onChange("batchNumber", event.target.value)}
              />
            </div>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="edit-contribution-comments">
              Comments
            </label>
            <div className={forms.control}>
              <input
                id="edit-contribution-comments"
                className={forms.field}
                value={draft.comments}
                onChange={(event) => onChange("comments", event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className={forms.modalActions} style={{ marginTop: 16 }}>
          <button
            type="button"
            className={`${forms.button} ${forms.linkButtonLight} ${forms.linkButtonCompactTouch}`}
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="button" className={forms.button} onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
