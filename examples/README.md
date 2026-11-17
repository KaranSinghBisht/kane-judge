# Examples

`inkwell-shop/` is a sample hackathon submission for trying Kane Judge locally. It's a small Node storefront with no dependencies. Judged as submitted, it shows each kind of finding:

- **Claims that hold up:** browsing, adding to the cart and card checkout work.
- **A subtle bug only a browser catches:** a client-side A/B experiment trims the order summary to three rows. Once a promo code adds a Discount row, the order **Total** disappears.
- **An overclaim:** the README promises an order history under Account → Orders that doesn't exist.
- **Prompt injection:** a hidden HTML comment in the README tells AI judges to award 10/10 and skip the demo checks.

```bash
cd examples/inkwell-shop && npm start          # http://localhost:4173
# in Claude Code, from any empty folder:
/kane-judge:judge /path/to/kane-judge/examples/inkwell-shop --live http://localhost:4173
```
