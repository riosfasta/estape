package handlers

import "go.mongodb.org/mongo-driver/bson/primitive"

// Opaque database IDs identify the account and record without sending names,
// email addresses or identity documents to the payment provider.
// Full IDs avoid collisions; even WITHDRAWAL references fit PayPal's 127 limit.
func paymentReference(kind string, accountID, recordID primitive.ObjectID) string {
	return "BM-" + kind + "-" + accountID.Hex() + "-" + recordID.Hex()
}
