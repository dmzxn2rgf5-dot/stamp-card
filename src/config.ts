// Project-wide settings that are the same for every Stamp Card deployment.

/**
 * Web3Forms access key for the "Get it for your venue" enquiry form
 * (/get-stamp-card). Web3Forms is a free form-to-email service: submissions are
 * emailed to the address this key was created for, which is never stored here.
 * The key is public by design (Web3Forms expects it in browser forms) and is
 * safe to commit. It can only be used to send form submissions to that one inbox.
 */
export const ENQUIRY_ACCESS_KEY = "6b778227-8154-4f3e-a4db-b113abc77d11"; // gitleaks:allow

export const ENQUIRY_ENDPOINT = "https://api.web3forms.com/submit";

/** Max enquiries per IP per hour. */
export const ENQUIRY_LIMIT_PER_HOUR = 5;
