# Illustrative curation protocol, king quail bCotChi1 (hap1 + hap2 combined map).
# Every line is an operation or a check. Re-running this file reproduces the
# curation exactly, and the asserts make it fail loudly if the input assembly
# is not the one the protocol was written against.

assert contigs == 645
assert n50 > 40Mb

# Reverse a scaffold whose diagonal runs the wrong way.
invert H1.scaffold_4

# Bring a mis-ordered scaffold next to its neighbour.
move H1.scaffold_54 after H1.scaffold_1

# Group a scaffold into a named chromosome.
scaffold create SUPER_1
scaffold paint H1.scaffold_1 SUPER_1

# Curation rearranges sequence; it must never lose any.
assert contigs == 645
assert scaffolds == 1
