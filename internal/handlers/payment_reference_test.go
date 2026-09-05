package handlers

import (
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestPaymentReferenceIdentifiesAccountAndRecord(t *testing.T) {
	account, record := primitive.NewObjectID(), primitive.NewObjectID()
	for _, kind := range []string{"PLAN", "TOPUP", "REFUND", "WITHDRAWAL"} {
		ref := paymentReference(kind, account, record)
		if ref != "BM-"+kind+"-"+account.Hex()+"-"+record.Hex() || len(ref) > 127 {
			t.Fatalf("invalid reference: %s", ref)
		}
		if !strings.Contains(ref, record.Hex()) || ref == paymentReference(kind, account, primitive.NewObjectID()) {
			t.Fatal("payment records must have distinct references")
		}
	}
}
