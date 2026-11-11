# Point this terminal at the demo cluster, and nothing else:
#   source env.sh
# Uses a kubeconfig private to this folder, so your real clusters in
# ~/.kube/config are out of reach while you demo.
export KUBECONFIG="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/.kube/config"
echo "kubectl -> $KUBECONFIG"
