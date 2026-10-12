// Ready-made templates users can add with one click.
const p = (...lines) => lines.map((l) => `<p>${l}</p>`).join('');

export const STARTER_TEMPLATES = [
  {
    name: 'Formal Job Application (Recommended)',
    subject: 'Application for {{position}} Position at {{company}}',
    body: p(
      'Dear Hiring Manager,',
      'I am writing to express my interest in the {{position}} position at {{company}}.',
      'I have experience in [your field or relevant skills] and a strong interest in contributing to your team. My background in [relevant experience, qualifications, or key skills] has equipped me with the ability to [a relevant strength or contribution].',
      'I am enthusiastic about the opportunity to join {{company}} and contribute to its goals while continuing to develop my professional skills.',
      'Please find my CV attached for your consideration. I would welcome the opportunity to discuss how my qualifications and experience align with the requirements of this position.',
      'Thank you for your time and consideration. I look forward to hearing from you.',
      'Kind regards,<br>{{sender_name}}<br>[Your Phone Number]<br>[Your Email Address]<br>[LinkedIn Profile or Portfolio, if applicable]',
    ),
  },
  {
    name: 'Junior Software Developer (Recommended)',
    subject: 'Application for Junior Software Developer Position',
    body: p(
      'Dear Hiring Manager,',
      'I am writing to apply for the Junior Software Developer position at your organization.',
      'I have a background in Computer Science and experience working with technologies such as JavaScript, React, Node.js, PHP, and SQL. I enjoy building practical software solutions, solving technical problems, and learning new technologies.',
      'I am eager to contribute my technical skills, collaborate with experienced developers, and grow professionally within your organization.',
      'Please find my CV attached for your review. I would appreciate the opportunity to discuss my qualifications and how I could contribute to your team.',
      'Thank you for your time and consideration. I look forward to your response.',
      'Kind regards,<br>{{sender_name}}',
    ),
  },
  {
    name: 'Job Application',
    subject: 'Application for {{position}} Position',
    body: p('Dear {{name}},', 'I am writing to express my interest in the {{position}} position at {{company}}. With my background and skills, I am confident I could make a strong contribution to your team.', 'Please find my CV attached. I would be grateful for the opportunity to discuss my application further.', 'Best regards,<br>{{sender_name}}'),
  },
  {
    name: 'Follow Up',
    subject: 'Following up on my {{position}} application',
    body: p('Dear {{name}},', 'I hope you are well. I wanted to follow up on my application for the {{position}} role at {{company}} and reiterate my interest in the opportunity.', 'If there is any additional information I can provide, please let me know. Thank you for your time and consideration.', 'Kind regards,<br>{{sender_name}}'),
  },
  {
    name: 'Networking Outreach',
    subject: 'Connecting about opportunities at {{company}}',
    body: p('Hi {{name}},', 'I admire the work {{company}} is doing and I am exploring opportunities in the {{position}} space. I would love to learn more about your team and any openings that might be a fit.', 'Would you be open to a brief conversation? My CV is attached for context.', 'Thank you,<br>{{sender_name}}'),
  },
  {
    name: 'Internship Application',
    subject: 'Application for {{position}} Internship',
    body: p('Dear {{name}},', 'I am excited to apply for the {{position}} internship at {{company}}. I am a motivated learner eager to gain hands-on experience and contribute wherever I can.', 'I have attached my CV for your review and would welcome the chance to speak with you.', 'Sincerely,<br>{{sender_name}}'),
  },
  {
    name: 'Referral Request',
    subject: 'Quick question about {{position}} at {{company}}',
    body: p('Hi {{name}},', 'I noticed {{company}} is hiring for a {{position}} and I believe my experience is a strong match. Would you be willing to point me to the right person, or share any advice on applying?', 'I have attached my CV. I really appreciate your time.', 'Best,<br>{{sender_name}}'),
  },
  {
    name: 'Thank You After Interview',
    subject: 'Thank you, {{position}} interview',
    body: p('Dear {{name}},', 'Thank you for taking the time to speak with me about the {{position}} role at {{company}}. I enjoyed learning more about the team and I am even more excited about the opportunity.', 'Please let me know if you need anything further from me.', 'Warm regards,<br>{{sender_name}}'),
  },
];
