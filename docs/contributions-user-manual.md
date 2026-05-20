# Contributions System User Manual

This manual explains how to use the Contributions system to enter donations, review donor history, download reports, send tax receipts, and manage access.

## Who should use this system

The Contributions system is for users who record and review contribution information. It is separate from the EMC area of the application.

There are two contribution access levels:

- **User**: can work with contributions for assigned countries only.
- **Admin**: can work across the contribution system and manage contribution access for other users.

If you can access both EMC and Contributions, use the system switcher in the top navigation to move between them.

## Getting started

1. Sign in to the application.
2. Open **Contributions**.
3. Use the **Contributions Dashboard** to choose the task you need:
   - **Enter Contributions**
   - **View Donors**
   - **View Contributions & Download Reports**
   - **Access Configuration** (admin only)

If you see a message saying access is not configured, contact a Contributions admin.

## Enter Contributions

Use **Enter Contributions** when you need to record one or more recently received contributions.

### Enter a batch

1. Open **Contributions > Enter Contributions**.
2. In the **Member** field, type at least two letters of the donor's first or last name.
3. Select the correct donor from the search results.
4. Enter the **Amount**.
5. Select the **Fund Type**:
   - Cash
   - Check
   - Bank Transfer
6. Select the **Currency**.
7. Enter a **Check No.** only when the fund type is **Check**.
8. Select the **Contribution Type**.
9. Enter the **Date Deposited**.
10. Confirm or adjust the **Date Entered**.
11. Add **Comments** if needed.
12. Use **Add Row** for more entries.
13. Select **Save Contributions**.

The page starts with several blank rows. Empty rows are ignored when saving.

### Date behavior

When you enter a valid **Date Deposited**, the system may carry that date into following blank rows. This is intended to make batch entry faster when several contributions were deposited on the same date.

### Today's entered contributions

After saving, the lower section shows **Today's Entered Contributions**. This includes contributions entered by you today.

From this section you can:

- Review what you entered today.
- Download a **Daily Entry Report**.
- Edit a contribution.
- Delete a contribution.

If the donor is wrong, delete the contribution and re-enter it. Donor changes are not editable from the edit dialog.

## View Donors

Use **View Donors** when you want to look up one donor or household, review their contribution history, download donor-specific PDFs, or send an individual tax receipt.

### Find a donor

1. Open **Contributions > View Donors**.
2. Type at least two letters in the **Donor** search field.
3. Select the donor from the results.

If needed, use **Browse all donors** to open a scrollable donor list.

### Review donor details

After selecting a donor, select **View Donor Details** to show member information such as:

- Primary member
- Email and phone numbers
- Address and country
- Baptism information
- Fellowship and tithing status
- Household members, when applicable

### Review donor contributions

The **Contributions** section shows the selected donor's contributions for the chosen date range.

1. Set **Start Date** and **End Date**.
2. Select **Apply Dates**.
3. Review the contribution rows.

From the contribution table you can:

- Edit amount, fund type, currency, check number, contribution type, date deposited, and comments.
- Delete a contribution.
- Download all displayed contributions as a PDF.

If the donor is wrong on an entry, delete the contribution and re-enter it.

### Individual tax receipts

For supported countries, the donor page can generate a donor tax receipt.

1. Select the donor.
2. Set the desired date range.
3. Select **Download Tax Receipt**.
4. If an email preview appears and the donor has an email address, select **Send Tax Receipt by Email**.

If the donor has no email address, the receipt can be downloaded and handled outside the system.

## View Contributions & Download Reports

Use **View Contributions & Download Reports** to search saved contributions and generate broader reports.

### Choose what to do

At the top of the page, select one mode:

- **View Contributions**
- **Grand Total Report**
- **Total per Donor Report**
- **Tax Receipts**

### Filter options

Use the filters that appear for the selected mode:

- **Start Date Deposited**
- **End Date Deposited**
- **Country**
- **Fund Type**
- **Contribution Type**

Contribution users only see data within their assigned country scope. Admins can work across the contribution system.

### View contributions

1. Select **View Contributions**.
2. Choose the date range and optional filters.
3. Select **View Contributions**.
4. Review the results table.

In the results table you can:

- Sort by member name, contribution type, date deposited, or date entered.
- Edit a contribution.
- Delete a contribution.
- Download the displayed results as a PDF.

If the member is wrong on an entry, delete the contribution and re-enter it.

### Grand Total Report

Use **Grand Total Report** to download a summary of totals for the selected period and filters.

1. Select **Grand Total Report**.
2. Choose the date range and optional filters.
3. Select **Download Grand Total**.

### Total per Donor Report

Use **Total per Donor Report** to download totals grouped by donor for the selected period and filters.

1. Select **Total per Donor Report**.
2. Choose the date range and optional filters.
3. Select **Download Total per Donor**.

### Tax Receipts

Use **Tax Receipts** to generate receipts for a country and period.

1. Select **Tax Receipts**.
2. Choose the date range.
3. Select a country. A country is required for tax receipts.
4. Select **Download Tax Receipts**.
5. Review the list of members whose receipts were generated.
6. Select the recipients who should receive email.
7. Select **Send Selected Tax Receipts by Email**.

Members with no email address are shown separately and should be handled outside the system.

## Access Configuration

Only Contributions admins can use **Access Configuration**.

Use this area to add, change, remove, or resend access for Contributions users.

### Add a user

1. Open **Contributions > Access Configuration**.
2. Select **Add**.
3. Search for the member by typing at least two letters.
4. Select the member.
5. Choose **Contributions Access**:
   - **Admin** for full contribution administration access.
   - **User** for country-scoped contribution access.
6. If you choose **User**, select at least one country.
7. Select **Save & Send Email Invitation**.

The system sends an invitation email when access is added for a new user.

### Edit access

1. Open **Access Configuration**.
2. Select **Edit** beside the user.
3. Adjust the role or country list.
4. Select **Save changes**.

Admins do not use country selections. Users must have at least one country selected.

### Resend an invite

1. Open **Access Configuration**.
2. Select **Resend Invite** beside the user.

The system sends a password reset or access email.

### Remove access

1. Open **Access Configuration**.
2. Select **Delete** beside the user.
3. Confirm the removal.

You cannot delete your own access from this page.

## Common rules and reminders

- Search fields usually require at least two letters before results appear.
- If a donor or member is incorrect on a contribution, delete the contribution and re-enter it.
- Check numbers are used for **Check** contributions.
- Empty contribution entry rows are ignored when saving a batch.
- Users only see the countries assigned to them.
- Admins can manage contribution access and can work across the contribution system.
- Reports are generated from the selected date range and filters.
- Tax receipt email sending requires an email address on the member record.

## Suggested operating process

For daily contribution entry:

1. Enter all received contributions in **Enter Contributions**.
2. Review **Today's Entered Contributions** before leaving the page.
3. Download the **Daily Entry Report** for the day's records.
4. Use **View Contributions & Download Reports** for period reporting.

For year-end or tax receipt work:

1. Use **View Contributions & Download Reports > Tax Receipts**.
2. Select the country and date range.
3. Download receipts first.
4. Email selected receipts from the generated recipient list.
5. Manually handle members with no email address.

## Getting help

If you cannot find a donor, cannot see a country, or cannot access a page you expect to use, contact a Contributions admin. The most common cause is missing or incorrect contribution access configuration.
