import Link from "next/link";
import forms from "@/styles/forms.module.css";

export function EmcDashboardContent() {
  return (
    <>
      <section className={forms.sectionCard} style={{ marginTop: 12 }}>
        <h2>Quick Access</h2>
        <ul
          className={forms.listButtons}
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
        >
          <li>
            <Link href="/members" className={forms.listButtonLink}>
              <span className={forms.listButtonIcon}>MEM</span>
              <span>Members</span>
            </Link>
          </li>
          <li>
            <Link href="/elders" className={forms.listButtonLink}>
              <span className={forms.listButtonIcon}>ELD</span>
              <span>Elders</span>
            </Link>
          </li>
          <li>
            <Link href="/fot-reg" className={forms.listButtonLink}>
              <span className={forms.listButtonIcon}>FOT</span>
              <span>FOT Registration</span>
            </Link>
          </li>
        </ul>
      </section>

      <section className={forms.sectionCard} style={{ marginTop: 12 }}>
        <h2>Documents</h2>
        <div style={{ display: "grid", gap: 18 }}>
          <div>
            <h3 style={{ margin: "0 0 10px" }}>Anointing Docs</h3>
            <ul
              className={forms.listButtons}
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
            >
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Anoint_Ltr_2018.docx"
                >
                  <span className={forms.listButtonIcon}>DOC</span>
                  Anointing - EN
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Anoint-ES.docx"
                >
                  <span className={forms.listButtonIcon}>DOC</span>
                  Anointing - ES
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Anoint-FR.docx"
                >
                  <span className={forms.listButtonIcon}>DOC</span>
                  Anointing - FR
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Anoint-NL.docx"
                >
                  <span className={forms.listButtonIcon}>DOC</span>
                  Anointing - NL
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 style={{ margin: "0 0 10px" }}>Baptism Docs</h3>
            <ul
              className={forms.listButtons}
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
            >
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Baptism.pdf"
                  download
                >
                  <span className={forms.listButtonIcon}>PDF</span>
                  Baptism - EN
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/baptism_nl.pdf"
                  download
                >
                  <span className={forms.listButtonIcon}>PDF</span>
                  Baptism - NL
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 style={{ margin: "0 0 10px" }}>Holy Day Letters</h3>
            <ul
              className={forms.listButtons}
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
            >
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Holidays_Ltr.pdf"
                  download
                >
                  <span className={forms.listButtonIcon}>PDF</span>
                  Holidays Form Letter
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Excused_Spring.doc"
                >
                  <span className={forms.listButtonIcon}>DOC</span>
                  Excused Absence Form Letter (Spring Holy Days)
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Excused_Absence_Form.doc"
                >
                  <span className={forms.listButtonIcon}>DOC</span>
                  Excused Absence Form Letter (Fall Holy Days)
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 style={{ margin: "0 0 10px" }}>Other Docs</h3>
            <ul
              className={forms.listButtons}
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
            >
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/2T-Request-Form-2025.doc"
                >
                  <span className={forms.listButtonIcon}>DOC</span>
                  2nd Tithe Request Forms
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/passover_home.pdf"
                  download
                >
                  <span className={forms.listButtonIcon}>PDF</span>
                  Passover Service (Home)
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Marriage.rtf"
                >
                  <span className={forms.listButtonIcon}>RTF</span>
                  Wedding (rough draft, can be customized)
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Funeral.rtf"
                >
                  <span className={forms.listButtonIcon}>RTF</span>
                  Funeral (rough draft, can be customized)
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Jury_Duty.rtf"
                >
                  <span className={forms.listButtonIcon}>RTF</span>
                  Jury Duty
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/working-with-new-people.pdf"
                  download
                >
                  <span className={forms.listButtonIcon}>PDF</span>
                  Procedures for Answering E-mail
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/Sabbath_Observance.rtf"
                >
                  <span className={forms.listButtonIcon}>RTF</span>
                  Sabbath Observance Form Letter
                </a>
              </li>
              <li>
                <a
                  className={forms.listButtonLink}
                  href="/documents/download?path=documents/SSOutline.rtf"
                >
                  <span className={forms.listButtonIcon}>RTF</span>
                  Selective Service Outline (serving in military, must be customized)
                </a>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className={forms.sectionCard} style={{ marginTop: 28 }}>
        <h2>Miscellaneous</h2>
        <ul className={forms.listNotes}>
          <li className={forms.listNoteItem}>
            Expenses (U.S. only): Send Laura an itemized list of your reimbursable expenses at{" "}
            <a href="mailto:rlweinland@gmail.com">rlweinland@gmail.com</a>. This email address is
            not to be shared with anyone. No receipts are required to be submitted but retain all
            of your receipts for at least 1 year.
          </li>
          <li className={forms.listNoteItem}>
            When calling new contacts, it is wise to either use a calling card or to dial *67
            before dialing their number so that your phone number is blocked from their caller id.
          </li>
          <li className={forms.listNoteItem}>
            It is your responsibility to collect thorough contact information (address, email and
            phone number(s)) on all newly baptized members and to forward that information to Audra
            Weinland (<a href="mailto:audra.weinland@gmail.com">audra.weinland@gmail.com</a>) so
            that it can be included in the Church&apos;s records.
          </li>
          <li className={forms.listNoteItem}>
            Tithing Addresses:
            <div className={forms.addressGrid}>
              <div className={forms.addressCard}>
                <strong>U.S.</strong>
                <div>The Church of God - PKG</div>
                <div>P.O. Box 14447</div>
                <div>Cincinnati, OH 45250</div>
              </div>
              <div className={forms.addressCard}>
                <strong>Canada</strong>
                <div>Church of God - PKG</div>
                <div>Box 108</div>
                <div>Rosalind, AB T0B 3Y0</div>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </>
  );
}
