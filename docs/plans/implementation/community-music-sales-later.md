# Selling Community Music: Notes for Later Review

**Status (2026-10-10):** Not planned for now. Community music is free (see `community-music-sharing-v1.md`). These notes record what the project owner wants considered before community music can ever be sold, so the decision can be made later with the full picture.

## Owner's direction (2026-10-10)

- Start free. Creators can't sell community music at launch.
- Selling later must be **exclusive** and **opt-in**. A creator signs up for a creator programme. Selling isn't a switch any player can flip.
- Before anything is sold, the rights must be explicit. The creator either:
  - grants SynaptixPlay the rights it needs to sell the music, or
  - assigns ownership of the music to SynaptixPlay,

  in return for a revenue share.
- The design must stop people from gaming it to make extra money.

## Questions to settle before building

### Rights and agreements

- Licence or assignment? A licence lets the creator keep ownership while SynaptixPlay sells it. An assignment transfers ownership to SynaptixPlay. This affects whether creators can sell the same music elsewhere.
- Exclusivity: is music sold on SynaptixPlay banned from other stores and platforms, and for how long?
- What the creator warrants: that they made it, that it uses no one else's work, and which AI tools were involved (provenance from `publication-rules-v1.md`).
- Purely AI-generated music may have no copyright owner. Should sellable music require a minimum amount of human editing, using the `editShare` measure?
- Who can join: age (no minors without a guardian's agreement), identity checks, tax forms and payout details.

### Money

- The revenue share and how it's calculated (after store fees and refunds).
- The payout schedule, minimum payout, currency, and how chargebacks and refunds are clawed back.
- Prices: does the creator set them within limits, or does SynaptixPlay set them?
- Stability AI's US$1M threshold and other licence limits, if sold music used an AI audio model.

### Stopping abuse

- **Self-dealing:** buying your own music with alternate accounts or gifted currency. Sales from related accounts don't count toward payouts.
- **Copying:** selling re-uploads or near-copies of someone else's music. The melody check covers both store and community music, and a duplicate check covers files.
- **Ripping off community music:** selling what was shared free. Shared community music stays free forever; only new music published into the creator programme can be sold.
- **Review bombing and fake reports:** report rate limits and moderator review.
- **Payout holds:** for new creators, and while reports are open.

### Players

- Whether bought music works in every SynaptixPlay game or only one.
- What happens to bought music after a takedown: a refund, or a replacement version.
- Kids' accounts: purchase limits and parental approval, following the store's rules.

## What can be built now to keep the door open

- Keep the platform's `kind` field open to a future `creator-store` kind.
- Keep a store SKU link that any package can use, not just official ones.
- Keep provenance and `editShare` on every version. The creator programme's eligibility rules will need them.

## Revision

- 2026-10-10: first notes, from the owner's direction.
