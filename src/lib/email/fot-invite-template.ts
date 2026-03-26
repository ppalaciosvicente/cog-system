export type FotInviteMessage = {
  to: string;
  firstName: string;
  lastName: string;
  link: string;
  year: number;
};

export function buildFotInviteSubject(year: number) {
  return `${year} FoT Registration`;
}

export function buildFotInviteHtml(message: FotInviteMessage) {
  const fullName = [message.firstName, message.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const greeting = fullName ? `Dear ${fullName},` : "Dear member,";

  return `
<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
  <p>${greeting}</p>
  <p>The Church of God-PKG ${message.year} Feast of Tabernacles registration site is available for you to register for the site of your choice.</p>
  <p>BEFORE you book your accommodation, PLEASE REGISTER for a Feast site using the corresponding “Register for this Site” button on the registration page. Once you have registered, you can click on the link to book your accommodation on that same registration page.</p>
  <p>Booking a room and registering on the FOT sign-up page are two different things. Again, please make sure you register for the feast site first so that we know how many people will be attending at each site and so that you will receive any future emails regarding that specific Feast site.</p>
  <p>
    <a href="${message.link}" style="display:inline-block;padding:10px 14px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">
      Register for FoT
    </a>
  </p>
  <p>If the button above does not work, copy and paste this URL into your browser:</p>
  <p><a href="${message.link}">${message.link}</a></p>
  <p>Even if you will not be attending an organized Feast site this year, it is still important that you register that you will not be attending. Also, if you want to make changes to your registration, please do it yourself by logging in again and selecting the new site of your choice.</p>
  <p>Best Regards,</p>
  <p>COG-PKG</p>
</div>
`.trim();
}
